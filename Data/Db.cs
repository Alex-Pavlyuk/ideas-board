using Npgsql;

namespace IdeasBoard.Data;

/// <summary>
/// Owns the connection to Postgres and the schema. Everything else in Data/
/// takes an <see cref="NpgsqlConnection"/> from <see cref="Open"/>.
///
/// The board used to keep everything in one SQLite file inside the container,
/// which is the right call for ten users — until you meet a deployment that
/// replaces the container on every release. A <c>VOLUME</c> with no explicit
/// mount gives Docker a fresh anonymous volume per container, so each release
/// started from an empty file and the whole board was silently recreated. The
/// data lives in Postgres now, outside the application container's lifetime.
///
/// Still no EF Core: the schema is six tables and the queries are written by
/// hand, so an ORM would only add startup cost and a migration toolchain.
/// </summary>
public sealed class Db : IDisposable
{
    private readonly NpgsqlDataSource _source;

    public Db(IConfiguration config)
    {
        // A ready-made connection string wins; otherwise it is assembled from
        // separate DB_* variables. Keeping them separate matters for secret
        // masking in CI: a value containing ";" often cannot be masked, and a
        // whole connection string always contains one.
        var explicitString = config.GetConnectionString("Default");
        var connectionString = !string.IsNullOrWhiteSpace(explicitString)
            ? explicitString
            : new NpgsqlConnectionStringBuilder
            {
                Host = config["DB_HOST"] ?? "127.0.0.1",
                Port = int.TryParse(config["DB_PORT"], out var port) ? port : 5432,
                Database = config["DB_NAME"] ?? "ideas",
                Username = config["DB_USER"] ?? "ideas",
                Password = config["DB_PASSWORD"] ?? "",
                // The instance is shared with other projects, so the cap is a
                // courtesy as much as a limit: ten users never need more, and a
                // runaway loop cannot eat the instance's connection slots.
                MaxPoolSize = 20,
                Timeout = 10,
                CommandTimeout = 15,
            }.ConnectionString;

        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        Describe = $"{builder.Host}:{builder.Port}/{builder.Database} as {builder.Username}";
        _source = NpgsqlDataSource.Create(connectionString);
    }

    /// <summary>Host, database and user — safe to log, never the password.</summary>
    public string Describe { get; }

    /// <summary>
    /// True when the schema was already there at boot. Same question
    /// <c>/api/health</c> used to answer about the SQLite file: did the data
    /// survive this release, or are we looking at an empty board again.
    /// Set by <see cref="Migrate"/>, which runs before the first request.
    /// </summary>
    public bool ExistedAtBoot { get; private set; }

    public NpgsqlConnection Open() => _source.OpenConnection();

    /// <summary>
    /// One round trip, for /api/health. Returns the reason instead of throwing:
    /// the endpoint has to answer even when the database is the thing that is
    /// broken, otherwise the only symptom is a 502 with nothing to read.
    /// </summary>
    public string? ConnectionError()
    {
        try
        {
            using var cn = Open();
            using var cmd = cn.CreateCommand();
            cmd.CommandText = "SELECT 1";
            cmd.ExecuteScalar();
            return null;
        }
        catch (Exception e)
        {
            return e.Message;
        }
    }

    public void Dispose() => _source.Dispose();

    /// <summary>Creates the schema when missing. Idempotent — safe on every boot.</summary>
    public void Migrate()
    {
        using var cn = Open();

        using (var probe = cn.CreateCommand())
        {
            probe.CommandText = "SELECT to_regclass('public.users') IS NOT NULL";
            ExistedAtBoot = probe.ExecuteScalar() is true;
        }

        // Postgres, unlike most databases, runs DDL inside a transaction, so a
        // half-created schema is not a state this can end up in.
        using var tx = cn.BeginTransaction();
        using (var cmd = cn.CreateCommand())
        {
            cmd.Transaction = tx;
            cmd.CommandText = Schema;
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    /// <summary>
    /// Adds a column when it is missing. Not used by the current schema — every
    /// column below is in the CREATE TABLE — but a column added in a later
    /// release must come through here, because CREATE TABLE IF NOT EXISTS does
    /// nothing to a table that already exists.
    /// </summary>
    public void EnsureColumn(string table, string column, string type)
    {
        using var cn = Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = $"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {type}";
        cmd.ExecuteNonQuery();
    }

    private const string Schema = """
        CREATE TABLE IF NOT EXISTS users (
          id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          email           text    NOT NULL,
          display_name    text    NOT NULL DEFAULT '',
          password_hash   text    NOT NULL,
          is_admin        boolean NOT NULL DEFAULT false,
          is_active       boolean NOT NULL DEFAULT true,
          created_at      bigint  NOT NULL,
          last_seen_at    bigint,
          -- GitLab SSO identity. Nullable: password accounts never fill these,
          -- and an account can be linked long after it was created.
          gitlab_id       text,
          gitlab_username text,
          gitlab_email    text
        );
        -- Addresses are matched case-insensitively, so uniqueness has to be too:
        -- the index is on lower(email), and every lookup says lower(...) as well.
        CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
        CREATE UNIQUE INDEX IF NOT EXISTS users_gitlab_id ON users (gitlab_id)
          WHERE gitlab_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS ideas (
          id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          text              text             NOT NULL,
          -- 0 new, 1 promising, 2 in_progress, 3 research, 4 hold, 5 buried.
          status            integer          NOT NULL DEFAULT 0,
          x                 double precision NOT NULL,
          y                 double precision NOT NULL,
          angle             double precision NOT NULL DEFAULT 0,
          author_id         bigint           NOT NULL REFERENCES users(id),
          created_at        bigint           NOT NULL,
          updated_at        bigint           NOT NULL,
          status_changed_at bigint,
          status_changed_by bigint REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS ideas_status ON ideas(status);

        CREATE TABLE IF NOT EXISTS sessions (
          id           text   PRIMARY KEY,
          user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at   bigint NOT NULL,
          expires_at   bigint NOT NULL,
          last_seen_at bigint NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

        -- Append-only activity log. Deliberately narrow: a row is a handful of
        -- integers, so a million events is tens of megabytes, not a gigabyte.
        -- `a`/`b` carry small numeric payloads (old/new status); `meta` is only
        -- populated for the few kinds that genuinely need text.
        CREATE TABLE IF NOT EXISTS events (
          id      bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          ts      bigint  NOT NULL,
          kind    integer NOT NULL,
          user_id bigint,
          idea_id bigint,
          a       integer,
          b       integer,
          meta    text
        );
        CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
        CREATE INDEX IF NOT EXISTS events_kind_ts ON events(kind, ts);
        CREATE INDEX IF NOT EXISTS events_user_ts ON events(user_id, ts);
        CREATE INDEX IF NOT EXISTS events_idea ON events(idea_id);

        -- "Who looked at the board, when, and for how long" — one row per visit
        -- rather than one row per heartbeat. A 30-minute visit costs one row.
        CREATE TABLE IF NOT EXISTS board_visits (
          id           bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          user_id      bigint  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          started_at   bigint  NOT NULL,
          last_beat_at bigint  NOT NULL,
          beats        integer NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS visits_user_started ON board_visits(user_id, started_at);
        CREATE INDEX IF NOT EXISTS visits_started ON board_visits(started_at);

        -- Pre-aggregated counts that survive raw-event pruning, so a dashboard
        -- built later still has full history to draw trends from.
        CREATE TABLE IF NOT EXISTS event_daily (
          day     integer NOT NULL,   -- yyyymmdd, UTC
          kind    integer NOT NULL,
          user_id bigint  NOT NULL DEFAULT 0,
          count   integer NOT NULL,
          PRIMARY KEY (day, kind, user_id)
        );

        -- Failed-login counters, one row per account and one per source address.
        -- Persisted rather than held in memory so a restart is not a free reset
        -- for whoever is guessing.
        CREATE TABLE IF NOT EXISTS login_throttle (
          scope        integer NOT NULL,   -- 0 = account (email), 1 = source (ip)
          key          text    NOT NULL,
          failures     integer NOT NULL DEFAULT 0,
          first_at     bigint  NOT NULL,
          last_at      bigint  NOT NULL,
          locked_until bigint,
          PRIMARY KEY (scope, key)
        );
        CREATE INDEX IF NOT EXISTS throttle_locked ON login_throttle(locked_until);

        CREATE TABLE IF NOT EXISTS meta (
          key   text PRIMARY KEY,
          value text NOT NULL
        );
        """;
}
