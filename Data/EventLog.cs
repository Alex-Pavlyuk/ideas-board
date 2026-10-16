using Npgsql;

namespace IdeasBoard.Data;

/// <summary>
/// Append-only activity log plus the daily rollup that outlives it.
///
/// Two things keep the log from growing without bound:
///   1. rows are narrow (integers; `meta` only where text is unavoidable);
///   2. every insert also bumps <c>event_daily</c>, so raw rows can be pruned
///      after the retention window while the counts a dashboard would draw
///      survive forever. See <see cref="Prune"/>.
/// </summary>
public sealed class EventLog(Db db)
{
    private readonly Db _db = db;

    public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    private static int DayKey(long unixSeconds)
    {
        var d = DateTimeOffset.FromUnixTimeSeconds(unixSeconds).UtcDateTime;
        return d.Year * 10000 + d.Month * 100 + d.Day;
    }

    public void Log(EventKind kind, long? userId = null, long? ideaId = null,
                    int? a = null, int? b = null, string? meta = null)
    {
        using var cn = _db.Open();
        Write(cn, null, kind, userId, ideaId, a, b, meta);
    }

    /// <summary>Log inside a caller-owned transaction, so the event and the change commit together.</summary>
    public static void Write(NpgsqlConnection cn, NpgsqlTransaction? tx, EventKind kind,
                             long? userId = null, long? ideaId = null,
                             int? a = null, int? b = null, string? meta = null)
    {
        var ts = Now();

        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = """
                INSERT INTO events (ts, kind, user_id, idea_id, a, b, meta)
                VALUES (@ts, @kind, @user, @idea, @a, @b, @meta)
                """;
            cmd.Parameters.AddWithValue("@ts", ts);
            cmd.Parameters.AddWithValue("@kind", (int)kind);
            cmd.AddOptional("@user", userId);
            cmd.AddOptional("@idea", ideaId);
            cmd.AddOptional("@a", a);
            cmd.AddOptional("@b", b);
            cmd.AddOptional("@meta", meta);
            cmd.ExecuteNonQuery();
        }

        using (var roll = cn.CreateCommand())
        {
            roll.Transaction = tx;
            roll.CommandText = """
                INSERT INTO event_daily (day, kind, user_id, count)
                VALUES (@day, @kind, @user, 1)
                ON CONFLICT (day, kind, user_id) DO UPDATE SET count = event_daily.count + 1
                """;
            roll.Parameters.AddWithValue("@day", DayKey(ts));
            roll.Parameters.AddWithValue("@kind", (int)kind);
            roll.Parameters.AddWithValue("@user", userId ?? 0);
            roll.ExecuteNonQuery();
        }
    }

    /// <summary>
    /// Opening the board is recorded as a *visit* (one row, extended by
    /// heartbeats) instead of an event per ping, which is what makes
    /// "time spent on the board" cheap to store and easy to query later.
    /// Returns true when this started a new visit.
    /// </summary>
    public bool TouchVisit(long userId, int gapSeconds = 300)
    {
        var ts = Now();
        using var cn = _db.Open();
        using var tx = cn.BeginTransaction();

        using (var upd = cn.CreateCommand())
        {
            upd.Transaction = tx;
            upd.CommandText = """
                UPDATE board_visits
                SET last_beat_at = @ts, beats = beats + 1
                WHERE id = (
                    SELECT id FROM board_visits
                    WHERE user_id = @user AND last_beat_at >= @cutoff
                    ORDER BY last_beat_at DESC LIMIT 1
                )
                """;
            upd.Parameters.AddWithValue("@ts", ts);
            upd.Parameters.AddWithValue("@user", userId);
            upd.Parameters.AddWithValue("@cutoff", ts - gapSeconds);
            if (upd.ExecuteNonQuery() > 0) { tx.Commit(); return false; }
        }

        using (var ins = cn.CreateCommand())
        {
            ins.Transaction = tx;
            ins.CommandText = """
                INSERT INTO board_visits (user_id, started_at, last_beat_at, beats)
                VALUES (@user, @ts, @ts, 1)
                """;
            ins.Parameters.AddWithValue("@user", userId);
            ins.Parameters.AddWithValue("@ts", ts);
            ins.ExecuteNonQuery();
        }

        Write(cn, tx, EventKind.BoardOpened, userId);
        tx.Commit();
        return true;
    }

    /// <summary>
    /// Drops raw events older than the retention window. The daily rollup and
    /// the visit rows are kept — they are small and are what long-range
    /// analytics actually reads.
    /// </summary>
    public int Prune(int retentionDays)
    {
        if (retentionDays <= 0) return 0;
        var cutoff = Now() - (long)retentionDays * 86400;

        using var cn = _db.Open();
        int deleted;
        using (var cmd = cn.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM events WHERE ts < @cutoff AND kind <> @keep";
            cmd.Parameters.AddWithValue("@cutoff", cutoff);
            // Keep the pruning markers themselves, so the log explains its own gaps.
            cmd.Parameters.AddWithValue("@keep", (int)EventKind.LogPruned);
            deleted = cmd.ExecuteNonQuery();
        }

        // Expired sessions are not worth keeping either.
        using (var cmd = cn.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM sessions WHERE expires_at < @now";
            cmd.Parameters.AddWithValue("@now", Now());
            cmd.ExecuteNonQuery();
        }

        // No VACUUM here: autovacuum returns the dead rows to the table's free
        // space by itself, and a manual full vacuum would take an exclusive lock
        // on a shared instance to save a few megabytes.
        if (deleted > 0) Write(cn, null, EventKind.LogPruned, a: deleted, b: retentionDays);

        return deleted;
    }
}
