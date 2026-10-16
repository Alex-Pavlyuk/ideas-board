namespace IdeasBoard.Data;

/// <summary>
/// Read-only queries over the activity log. Everything here is meant to be the
/// seed of a proper dashboard later — hence the aggregates come out of
/// <c>board_visits</c> and <c>event_daily</c>, which survive log pruning.
/// </summary>
public sealed class AnalyticsStore(Db db)
{
    private readonly Db _db = db;

    public sealed record EventRow(
        long Id, long Ts, int Kind, long? UserId, string? UserName,
        long? IdeaId, string? IdeaText, int? A, int? B, string? Meta);

    public sealed record UserActivity(
        long UserId, string Email, string Name, long? LastSeenAt,
        int Visits, long SecondsOnBoard, int IdeasCreated, int StatusChanges, int Logins);

    /// <summary>Newest first. <paramref name="beforeId"/> pages backwards through the log.</summary>
    public List<EventRow> Events(int? kind, long? userId, long? from, long? to, long? beforeId, int limit)
    {
        limit = Math.Clamp(limit, 1, 500);

        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT e.id, e.ts, e.kind, e.user_id, u.display_name, e.idea_id, i.text, e.a, e.b, e.meta
            FROM events e
            LEFT JOIN users u ON u.id = e.user_id
            LEFT JOIN ideas i ON i.id = e.idea_id
            WHERE (@kind   IS NULL OR e.kind    = @kind)
              AND (@user   IS NULL OR e.user_id = @user)
              AND (@from   IS NULL OR e.ts     >= @from)
              AND (@to     IS NULL OR e.ts     <= @to)
              AND (@before IS NULL OR e.id      < @before)
            ORDER BY e.id DESC
            LIMIT @limit
            """;
        // Typed, not AddWithValue: `@kind IS NULL` gives Postgres nothing to infer
        // a type from, and it refuses to guess. See Data/Sql.cs.
        cmd.AddOptional("@kind", kind);
        cmd.AddOptional("@user", userId);
        cmd.AddOptional("@from", from);
        cmd.AddOptional("@to", to);
        cmd.AddOptional("@before", beforeId);
        cmd.Parameters.AddWithValue("@limit", limit);

        using var r = cmd.ExecuteReader();
        var list = new List<EventRow>();
        while (r.Read())
        {
            list.Add(new EventRow(
                r.GetInt64(0), r.GetInt64(1), r.GetInt32(2),
                r.IsDBNull(3) ? null : r.GetInt64(3),
                r.IsDBNull(4) ? null : r.GetString(4),
                r.IsDBNull(5) ? null : r.GetInt64(5),
                r.IsDBNull(6) ? null : Truncate(r.GetString(6)),
                r.IsDBNull(7) ? null : r.GetInt32(7),
                r.IsDBNull(8) ? null : r.GetInt32(8),
                r.IsDBNull(9) ? null : r.GetString(9)));
        }
        return list;
    }

    private static string Truncate(string s) => s.Length > 80 ? s[..80] : s;

    /// <summary>
    /// Per-person interest numbers. Visit duration comes from the visit rows, so
    /// it stays accurate no matter how aggressively raw events are pruned.
    /// A visit with a single heartbeat counts as one minute rather than zero.
    /// </summary>
    public List<UserActivity> UserActivityBy(long? sinceTs)
    {
        var since = sinceTs ?? 0;

        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT u.id, u.email, u.display_name, u.last_seen_at,
                   COALESCE(v.visits, 0),
                   COALESCE(v.seconds, 0),
                   COALESCE(c.created, 0),
                   COALESCE(s.changed, 0),
                   COALESCE(l.logins, 0)
            FROM users u
            LEFT JOIN (
                -- GREATEST, not MAX: in Postgres MAX() is the aggregate, and the
                -- floor of one minute is per row, not across the group.
                SELECT user_id, COUNT(*)::int AS visits,
                       SUM(GREATEST(last_beat_at - started_at, 60)) AS seconds
                FROM board_visits WHERE started_at >= @since GROUP BY user_id
            ) v ON v.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*)::int AS created FROM events
                WHERE kind = 10 AND ts >= @since GROUP BY user_id
            ) c ON c.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*)::int AS changed FROM events
                WHERE kind = 11 AND ts >= @since GROUP BY user_id
            ) s ON s.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*)::int AS logins FROM events
                WHERE kind = 1 AND ts >= @since GROUP BY user_id
            ) l ON l.user_id = u.id
            ORDER BY v.seconds DESC NULLS LAST, u.email
            """;
        cmd.Parameters.AddWithValue("@since", since);

        using var r = cmd.ExecuteReader();
        var list = new List<UserActivity>();
        while (r.Read())
        {
            list.Add(new UserActivity(
                r.GetInt64(0), r.GetString(1), r.GetString(2),
                r.IsDBNull(3) ? null : r.GetInt64(3),
                r.GetInt32(4), r.GetInt64(5), r.GetInt32(6), r.GetInt32(7), r.GetInt32(8)));
        }
        return list;
    }

    /// <summary>Daily counts per kind, straight from the rollup — cheap enough to chart live.</summary>
    public List<(int Day, int Kind, int Count)> DailyTotals(int days)
    {
        var cutoffDate = DateTime.UtcNow.Date.AddDays(-Math.Clamp(days, 1, 730));
        var cutoff = cutoffDate.Year * 10000 + cutoffDate.Month * 100 + cutoffDate.Day;

        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT day, kind, SUM(count)::int FROM event_daily
            WHERE day >= @cutoff GROUP BY day, kind ORDER BY day
            """;
        cmd.Parameters.AddWithValue("@cutoff", cutoff);

        using var r = cmd.ExecuteReader();
        var list = new List<(int, int, int)>();
        while (r.Read()) list.Add((r.GetInt32(0), r.GetInt32(1), r.GetInt32(2)));
        return list;
    }

    /// <summary>How many events of one kind since <paramref name="sinceTs"/> (all time when null).</summary>
    public int CountOfKind(int kind, long? sinceTs)
    {
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM events WHERE kind = @kind AND ts >= @since";
        cmd.Parameters.AddWithValue("@kind", kind);
        cmd.Parameters.AddWithValue("@since", sinceTs ?? 0);
        return Convert.ToInt32(cmd.ExecuteScalar());
    }

    public (long Events, long Visits, long DbBytes, long? OldestEventTs) Storage()
    {
        using var cn = _db.Open();
        long Scalar(string sql)
        {
            using var c = cn.CreateCommand();
            c.CommandText = sql;
            var v = c.ExecuteScalar();
            return v is null or DBNull ? 0 : Convert.ToInt64(v);
        }

        var events = Scalar("SELECT COUNT(*) FROM events");
        var visits = Scalar("SELECT COUNT(*) FROM board_visits");
        var oldest = Scalar("SELECT MIN(ts) FROM events");
        // Our own database inside the shared instance, indexes included — the
        // successor to "size of the SQLite file" that the admin screen shows.
        var bytes = Scalar("SELECT pg_database_size(current_database())");

        return (events, visits, bytes, oldest == 0 ? null : oldest);
    }
}
