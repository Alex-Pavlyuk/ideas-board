using IdeasBoard.Data;
using Npgsql;

namespace IdeasBoard.Services;

/// <summary>
/// Brute-force protection for the sign-in form: exponential backoff counted per
/// account and, as a backstop, per source address.
///
/// Why backoff rather than a hard lock: a permanent lock hands an attacker a
/// denial-of-service — guess five times against the CEO's address and they are
/// out of their own board. Doubling delays make guessing hopeless (a dozen
/// wrong answers buys half an hour per attempt) while a real person who fumbled
/// their password is back in within a minute, and the administrator can clear
/// it immediately.
///
/// Counters live in SQLite, not in memory, so restarting the container is not a
/// free reset for whoever is knocking.
/// </summary>
public sealed class LoginGuard(Db db)
{
    public enum Scope { Account = 0, Source = 1 }

    /// <summary>Failures allowed before the delays start. Generous for a person, useless for a script.</summary>
    private const int AccountFreeAttempts = 5;
    /// <summary>Higher: a whole office shares one address, so this only catches spraying across accounts.</summary>
    private const int SourceFreeAttempts = 30;

    private const int FirstLockSeconds = 30;
    private const int AccountMaxLockSeconds = 30 * 60;
    private const int SourceMaxLockSeconds = 5 * 60;

    /// <summary>An hour of quiet forgives the counter — yesterday's typos must not lock anyone out today.</summary>
    private const int DecaySeconds = 60 * 60;

    private readonly Db _db = db;

    public sealed record Block(Scope Scope, int RetryAfterSeconds);

    public sealed record LockedRow(Scope Scope, string Key, int Failures, long Until);

    private static string Normalise(string email) => email.Trim().ToLowerInvariant();

    /// <summary>The block in force right now, or null when the attempt may proceed.</summary>
    public Block? CurrentBlock(string email, string source)
    {
        var now = EventLog.Now();
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT scope, locked_until FROM login_throttle
            WHERE locked_until > @now
              AND ((scope = 0 AND key = @email) OR (scope = 1 AND key = @source))
            ORDER BY locked_until DESC LIMIT 1
            """;
        cmd.Parameters.AddWithValue("@now", now);
        cmd.Parameters.AddWithValue("@email", Normalise(email));
        cmd.Parameters.AddWithValue("@source", source);

        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new Block((Scope)r.GetInt32(0), (int)Math.Max(1, r.GetInt64(1) - now));
    }

    /// <summary>Counts one failure against both scopes. Returns the block it triggered, if any.</summary>
    public Block? RecordFailure(string email, string source)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();
        var account = Bump(cn, tx, Scope.Account, Normalise(email), AccountFreeAttempts, AccountMaxLockSeconds);
        var origin = Bump(cn, tx, Scope.Source, source, SourceFreeAttempts, SourceMaxLockSeconds);
        tx.Commit();

        // Report whichever keeps them waiting longer.
        if (account is null) return origin;
        if (origin is null) return account;
        return account.RetryAfterSeconds >= origin.RetryAfterSeconds ? account : origin;
    }

    private static Block? Bump(NpgsqlConnection cn,
                               NpgsqlTransaction tx,
                               Scope scope, string key, int freeAttempts, int maxLockSeconds)
    {
        var now = EventLog.Now();

        int failures;
        using (var read = cn.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = "SELECT failures, last_at FROM login_throttle WHERE scope = @s AND key = @k";
            read.Parameters.AddWithValue("@s", (int)scope);
            read.Parameters.AddWithValue("@k", key);
            using var r = read.ExecuteReader();
            // A long quiet spell starts the count over.
            failures = r.Read() && now - r.GetInt64(1) <= DecaySeconds ? r.GetInt32(0) + 1 : 1;
        }

        long? lockedUntil = null;
        if (failures > freeAttempts)
        {
            // 30s, 1m, 2m, 4m, 8m … up to the cap.
            var steps = failures - freeAttempts - 1;
            var seconds = steps >= 30
                ? maxLockSeconds
                : (int)Math.Min((long)FirstLockSeconds << steps, maxLockSeconds);
            lockedUntil = now + seconds;
        }

        using (var write = cn.CreateCommand())
        {
            write.Transaction = tx;
            write.CommandText = """
                INSERT INTO login_throttle (scope, key, failures, first_at, last_at, locked_until)
                VALUES (@s, @k, @f, @now, @now, @until)
                ON CONFLICT(scope, key) DO UPDATE
                SET failures = @f, last_at = @now, locked_until = @until
                """;
            write.Parameters.AddWithValue("@s", (int)scope);
            write.Parameters.AddWithValue("@k", key);
            write.Parameters.AddWithValue("@f", failures);
            write.Parameters.AddWithValue("@now", now);
            write.AddOptional("@until", lockedUntil);
            write.ExecuteNonQuery();
        }

        return lockedUntil is null ? null : new Block(scope, (int)(lockedUntil.Value - now));
    }

    /// <summary>
    /// Clears the account's counter on a correct password. The source counter is
    /// deliberately left to decay: otherwise one valid account would be a lever
    /// for resetting the backstop between guesses at every other account.
    /// </summary>
    public void RecordSuccess(string email)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "DELETE FROM login_throttle WHERE scope = 0 AND key = @k";
        cmd.Parameters.AddWithValue("@k", Normalise(email));
        cmd.ExecuteNonQuery();
    }

    /// <summary>Administrator override for someone who locked themselves out.</summary>
    public bool UnlockAccount(string email)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "DELETE FROM login_throttle WHERE scope = 0 AND key = @k";
        cmd.Parameters.AddWithValue("@k", Normalise(email));
        return cmd.ExecuteNonQuery() > 0;
    }

    public List<LockedRow> LockedNow()
    {
        var now = EventLog.Now();
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT scope, key, failures, locked_until FROM login_throttle
            WHERE locked_until > @now ORDER BY locked_until DESC
            """;
        cmd.Parameters.AddWithValue("@now", now);

        using var r = cmd.ExecuteReader();
        var list = new List<LockedRow>();
        while (r.Read())
            list.Add(new LockedRow((Scope)r.GetInt32(0), r.GetString(1), r.GetInt32(2), r.GetInt64(3)));
        return list;
    }

    /// <summary>Rows worth removing: expired, quiet and no longer counting toward anything.</summary>
    public int Prune()
    {
        var cutoff = EventLog.Now() - DecaySeconds;
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            DELETE FROM login_throttle
            WHERE last_at < @cutoff AND (locked_until IS NULL OR locked_until < @now)
            """;
        cmd.Parameters.AddWithValue("@cutoff", cutoff);
        cmd.Parameters.AddWithValue("@now", EventLog.Now());
        return cmd.ExecuteNonQuery();
    }
}
