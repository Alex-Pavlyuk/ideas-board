using IdeasBoard.Services;
using Npgsql;

namespace IdeasBoard.Data;

public sealed class UserStore(Db db)
{
    private readonly Db _db = db;

    private static User Read(NpgsqlDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2),
        r.GetBoolean(3), r.GetBoolean(4),
        r.GetInt64(5), r.IsDBNull(6) ? null : r.GetInt64(6),
        r.IsDBNull(7) ? null : r.GetString(7));

    private const string Columns =
        "id, email, display_name, is_admin, is_active, created_at, last_seen_at, gitlab_username";

    public List<User> All()
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users ORDER BY is_admin DESC, email";
        using var r = cmd.ExecuteReader();
        var list = new List<User>();
        while (r.Read()) list.Add(Read(r));
        return list;
    }

    public User? ById(long id)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", id);
        using var r = cmd.ExecuteReader();
        return r.Read() ? Read(r) : null;
    }

    public int Count()
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM users";
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    /// <summary>Verifies credentials. Returns null for unknown, disabled or wrong-password.</summary>
    public User? Authenticate(string email, string password)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        // lower() on both sides, matching the unique index: an address is the
        // same account whatever case someone typed it in.
        cmd.CommandText = $"SELECT {Columns}, password_hash FROM users WHERE lower(email) = lower(@email)";
        cmd.Parameters.AddWithValue("@email", email.Trim());
        using var r = cmd.ExecuteReader();
        if (!r.Read())
        {
            // Verify against a throwaway hash so an unknown address costs the
            // same ~100 ms as a known one. Returning early here would let an
            // attacker enumerate accounts by response time alone.
            PasswordHasher.Verify(password, DecoyHash.Value);
            return null;
        }

        var user = Read(r);
        var hash = r.GetString(8);
        if (!PasswordHasher.Verify(password, hash)) return null;
        return user.IsActive ? user : null;
    }

    private static readonly Lazy<string> DecoyHash =
        new(() => PasswordHasher.Hash(Guid.NewGuid().ToString("N")));

    /// <summary>Returns null when the email is already taken.</summary>
    public User? Create(string email, string password, string displayName, bool isAdmin, long? actorId)
    {
        email = email.Trim();
        displayName = string.IsNullOrWhiteSpace(displayName) ? email.Split('@')[0] : displayName.Trim();

        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();
        long id;
        try
        {
            using var cmd = cn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO users (email, display_name, password_hash, is_admin, is_active, created_at)
                VALUES (@email, @name, @hash, @admin, true, @now)
                RETURNING id
                """;
            cmd.Parameters.AddWithValue("@email", email);
            cmd.Parameters.AddWithValue("@name", displayName);
            cmd.Parameters.AddWithValue("@hash", PasswordHasher.Hash(password));
            cmd.Parameters.AddWithValue("@admin", isAdmin);
            cmd.Parameters.AddWithValue("@now", EventLog.Now());
            id = (long)cmd.ExecuteScalar()!;
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }

        EventLog.Write(cn, tx, EventKind.UserCreated, actorId, a: (int)id, meta: email);
        tx.Commit();
        return ById(id);
    }

    public bool SetPassword(long userId, string password, long? actorId)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE users SET password_hash = @hash WHERE id = @id";
            cmd.Parameters.AddWithValue("@hash", PasswordHasher.Hash(password));
            cmd.Parameters.AddWithValue("@id", userId);
            if (cmd.ExecuteNonQuery() == 0) return false;
        }
        // Force re-login everywhere: a reset password must invalidate live sessions.
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM sessions WHERE user_id = @id";
            cmd.Parameters.AddWithValue("@id", userId);
            cmd.ExecuteNonQuery();
        }
        EventLog.Write(cn, tx, EventKind.UserPasswordReset, actorId, a: (int)userId);
        tx.Commit();
        return true;
    }

    public bool SetActive(long userId, bool active, long? actorId)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE users SET is_active = @active WHERE id = @id";
            cmd.Parameters.AddWithValue("@active", active);
            cmd.Parameters.AddWithValue("@id", userId);
            if (cmd.ExecuteNonQuery() == 0) return false;
        }
        if (!active)
        {
            using var cmd = cn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM sessions WHERE user_id = @id";
            cmd.Parameters.AddWithValue("@id", userId);
            cmd.ExecuteNonQuery();
        }
        EventLog.Write(cn, tx, EventKind.UserActivationChanged, actorId, a: (int)userId, b: active ? 1 : 0);
        tx.Commit();
        return true;
    }

    public bool Rename(long userId, string displayName)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "UPDATE users SET display_name = @name WHERE id = @id";
        cmd.Parameters.AddWithValue("@name", displayName.Trim());
        cmd.Parameters.AddWithValue("@id", userId);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>
    /// Deleting an account keeps their ideas on the board (the board is the
    /// team's memory, not the person's), so the FK on ideas.author_id stops
    /// the delete unless the caller reassigns first. We reassign to the actor.
    /// </summary>
    public bool Delete(long userId, long actorId)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE ideas SET author_id = @actor WHERE author_id = @id";
            cmd.Parameters.AddWithValue("@actor", actorId);
            cmd.Parameters.AddWithValue("@id", userId);
            cmd.ExecuteNonQuery();
        }
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE ideas SET status_changed_by = NULL WHERE status_changed_by = @id";
            cmd.Parameters.AddWithValue("@id", userId);
            cmd.ExecuteNonQuery();
        }

        string? email;
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM users WHERE id = @id RETURNING email";
            cmd.Parameters.AddWithValue("@id", userId);
            email = cmd.ExecuteScalar() as string;
        }
        if (email is null) return false;

        EventLog.Write(cn, tx, EventKind.UserDeleted, actorId, a: (int)userId, meta: email);
        tx.Commit();
        return true;
    }

    // ---------------------------------------------------------------- GitLab

    public User? ByGitLabId(string gitlabId)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users WHERE gitlab_id = @id";
        cmd.Parameters.AddWithValue("@id", gitlabId);
        using var r = cmd.ExecuteReader();
        return r.Read() ? Read(r) : null;
    }

    /// <summary>Matches the account's own address first, then one linked earlier.</summary>
    public User? ByAnyEmail(string email)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = $"SELECT {Columns} FROM users"
                        + " WHERE lower(email) = lower(@email) OR lower(gitlab_email) = lower(@email)"
                        + " ORDER BY (lower(email) = lower(@email)) DESC LIMIT 1";
        cmd.Parameters.AddWithValue("@email", email.Trim());
        using var r = cmd.ExecuteReader();
        return r.Read() ? Read(r) : null;
    }

    /// <summary>
    /// Attaches a GitLab identity to an existing account. Returns false when that
    /// identity already belongs to someone else: the unique index would reject it
    /// anyway, and silently moving a link between accounts would be worse.
    /// </summary>
    public bool LinkGitLab(long userId, string gitlabId, string username, string? email)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        using (var check = cn.CreateCommand())
        {
            check.Transaction = tx;
            check.CommandText = "SELECT id FROM users WHERE gitlab_id = @gid AND id <> @uid";
            check.Parameters.AddWithValue("@gid", gitlabId);
            check.Parameters.AddWithValue("@uid", userId);
            if (check.ExecuteScalar() is not null) return false;
        }

        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE users SET gitlab_id = @gid, gitlab_username = @name,"
                            + " gitlab_email = @email WHERE id = @uid";
            cmd.Parameters.AddWithValue("@gid", gitlabId);
            cmd.Parameters.AddWithValue("@name", username);
            cmd.AddOptional("@email", email);
            cmd.Parameters.AddWithValue("@uid", userId);
            if (cmd.ExecuteNonQuery() == 0) return false;
        }

        EventLog.Write(cn, tx, EventKind.GitLabLinked, userId, meta: username);
        tx.Commit();
        return true;
    }

    /// <summary>Removes the GitLab link, leaving the account and its password intact.</summary>
    public bool UnlinkGitLab(long userId)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "UPDATE users SET gitlab_id = NULL, gitlab_username = NULL,"
                        + " gitlab_email = NULL WHERE id = @uid";
        cmd.Parameters.AddWithValue("@uid", userId);
        return cmd.ExecuteNonQuery() > 0;
    }

    /// <summary>
    /// Provisions an account from a GitLab profile. Only reachable when
    /// GITLAB_AUTO_CREATE is on — see GitLabOAuth. The generated password is
    /// discarded: these accounts sign in through GitLab, and an administrator
    /// can always reset it if someone needs a password too.
    /// </summary>
    public User? CreateFromGitLab(string email, string displayName, string gitlabId, string username)
    {
        var user = Create(email, PasswordHasher.GenerateReadable(5), displayName, isAdmin: false, actorId: null);
        if (user is null) return null;
        LinkGitLab(user.Id, gitlabId, username, email);
        return ById(user.Id);
    }

    public void TouchLastSeen(long userId)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "UPDATE users SET last_seen_at = @now WHERE id = @id";
        cmd.Parameters.AddWithValue("@now", EventLog.Now());
        cmd.Parameters.AddWithValue("@id", userId);
        cmd.ExecuteNonQuery();
    }
}
