using Npgsql;

namespace IdeasBoard.Data;

public sealed class IdeaStore(Db db)
{
    private readonly Db _db = db;

    private const string Select = """
        SELECT i.id, i.text, i.status, i.x, i.y, i.angle, i.author_id,
               COALESCE(u.display_name, '?'), COALESCE(u.email, ''),
               i.created_at, i.updated_at, i.status_changed_at, i.status_changed_by
        FROM ideas i LEFT JOIN users u ON u.id = i.author_id
        """;

    private static Idea Read(NpgsqlDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetInt32(2),
        r.GetDouble(3), r.GetDouble(4), r.GetDouble(5),
        r.GetInt64(6), r.GetString(7), r.GetString(8),
        r.GetInt64(9), r.GetInt64(10),
        r.IsDBNull(11) ? null : r.GetInt64(11),
        r.IsDBNull(12) ? null : r.GetInt64(12));

    /// <summary>
    /// The whole board in one query. Ten users and a few thousand notes make
    /// this a sub-millisecond read of a few hundred KB — paging it would buy
    /// nothing and would break the client-side spatial index.
    /// </summary>
    public List<Idea> All()
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = Select + " ORDER BY i.id";
        using var r = cmd.ExecuteReader();
        var list = new List<Idea>();
        while (r.Read()) list.Add(Read(r));
        return list;
    }

    public Idea? ById(long id) => ById(id, null, null);

    private Idea? ById(long id, NpgsqlConnection? cn, NpgsqlTransaction? tx)
    {
        var own = cn is null;
        cn ??= _db.Open();
        try
        {
            using var cmd = cn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = Select + " WHERE i.id = @id";
            cmd.Parameters.AddWithValue("@id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? Read(r) : null;
        }
        finally { if (own) cn.Dispose(); }
    }

    public Idea Create(string text, double x, double y, double angle, long authorId)
    {
        var now = EventLog.Now();
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        long id;
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO ideas (text, status, x, y, angle, author_id, created_at, updated_at)
                VALUES (@text, 0, @x, @y, @angle, @author, @now, @now)
                RETURNING id
                """;
            cmd.Parameters.AddWithValue("@text", text);
            cmd.Parameters.AddWithValue("@x", x);
            cmd.Parameters.AddWithValue("@y", y);
            cmd.Parameters.AddWithValue("@angle", angle);
            cmd.Parameters.AddWithValue("@author", authorId);
            cmd.Parameters.AddWithValue("@now", now);
            id = (long)cmd.ExecuteScalar()!;
        }

        // The first 80 characters are enough to recognise an idea in the log
        // after it has been hard-deleted from the board.
        EventLog.Write(cn, tx, EventKind.IdeaCreated, authorId, id,
                       meta: text.Length > 80 ? text[..80] : text);
        tx.Commit();
        return ById(id)!;
    }

    /// <summary>Returns (updated idea, previous status), or null when the idea is gone.</summary>
    public (Idea Idea, int OldStatus)? SetStatus(long ideaId, int status, long actorId)
    {
        var now = EventLog.Now();
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        int oldStatus;
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "SELECT status FROM ideas WHERE id = @id";
            cmd.Parameters.AddWithValue("@id", ideaId);
            var scalar = cmd.ExecuteScalar();
            if (scalar is null) return null;
            oldStatus = Convert.ToInt32(scalar);
        }
        if (oldStatus == status) return (ById(ideaId, cn, tx)!, oldStatus);

        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                UPDATE ideas
                SET status = @status, updated_at = @now,
                    status_changed_at = @now, status_changed_by = @actor
                WHERE id = @id
                """;
            cmd.Parameters.AddWithValue("@status", status);
            cmd.Parameters.AddWithValue("@now", now);
            cmd.Parameters.AddWithValue("@actor", actorId);
            cmd.Parameters.AddWithValue("@id", ideaId);
            cmd.ExecuteNonQuery();
        }

        EventLog.Write(cn, tx, EventKind.IdeaStatusChanged, actorId, ideaId, a: oldStatus, b: status);
        var updated = ById(ideaId, cn, tx)!;
        tx.Commit();
        return (updated, oldStatus);
    }

    public bool Move(long ideaId, double x, double y, double angle)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            UPDATE ideas SET x = @x, y = @y, angle = @angle, updated_at = @now WHERE id = @id
            """;
        cmd.Parameters.AddWithValue("@x", x);
        cmd.Parameters.AddWithValue("@y", y);
        cmd.Parameters.AddWithValue("@angle", angle);
        cmd.Parameters.AddWithValue("@now", EventLog.Now());
        cmd.Parameters.AddWithValue("@id", ideaId);
        return cmd.ExecuteNonQuery() > 0;
    }

    public Idea? EditText(long ideaId, string text, long actorId)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "UPDATE ideas SET text = @text, updated_at = @now WHERE id = @id";
            cmd.Parameters.AddWithValue("@text", text);
            cmd.Parameters.AddWithValue("@now", EventLog.Now());
            cmd.Parameters.AddWithValue("@id", ideaId);
            if (cmd.ExecuteNonQuery() == 0) return null;
        }
        EventLog.Write(cn, tx, EventKind.IdeaTextEdited, actorId, ideaId,
                       meta: text.Length > 80 ? text[..80] : text);
        var updated = ById(ideaId, cn, tx);
        tx.Commit();
        return updated;
    }

    /// <summary>Irreversible. Admin-only at the API layer — everyone else buries instead.</summary>
    public bool Delete(long ideaId, long actorId)
    {
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        string? text;
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = "DELETE FROM ideas WHERE id = @id RETURNING text";
            cmd.Parameters.AddWithValue("@id", ideaId);
            text = cmd.ExecuteScalar() as string;
        }
        if (text is null) return false;

        EventLog.Write(cn, tx, EventKind.IdeaDeleted, actorId, ideaId,
                       meta: text.Length > 80 ? text[..80] : text);
        tx.Commit();
        return true;
    }

    /// <summary>Counts per status, for the board header and the admin overview.</summary>
    public Dictionary<int, int> CountsByStatus()
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        // ::int because COUNT(*) is bigint in Postgres and the reader asks for int.
        cmd.CommandText = "SELECT status, COUNT(*)::int FROM ideas GROUP BY status";
        using var r = cmd.ExecuteReader();
        var map = new Dictionary<int, int>();
        while (r.Read()) map[r.GetInt32(0)] = r.GetInt32(1);
        return map;
    }
}
