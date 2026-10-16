using System.Security.Cryptography;
using IdeasBoard.Data;

namespace IdeasBoard.Services;

/// <summary>
/// Opaque server-side sessions in SQLite. Not a JWT: with a single instance and
/// ten users, a table lookup costs nothing and revoking a session (password
/// reset, account disabled) is a DELETE rather than a token-blacklist problem.
/// </summary>
public sealed class SessionStore(Db db)
{
    public const string CookieName = "ib_sid";
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(30);

    private readonly Db _db = db;

    public string Create(long userId)
    {
        var id = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
        var now = EventLog.Now();

        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
            VALUES (@id, @user, @now, @exp, @now)
            """;
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@user", userId);
        cmd.Parameters.AddWithValue("@now", now);
        cmd.Parameters.AddWithValue("@exp", now + (long)Lifetime.TotalSeconds);
        cmd.ExecuteNonQuery();
        return id;
    }

    public User? Resolve(string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return null;

        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = """
            SELECT u.id, u.email, u.display_name, u.is_admin, u.is_active, u.created_at,
                   u.last_seen_at, u.gitlab_username
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.id = @id AND s.expires_at > @now AND u.is_active
            """;
        cmd.Parameters.AddWithValue("@id", sessionId);
        cmd.Parameters.AddWithValue("@now", EventLog.Now());
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;

        return new User(r.GetInt64(0), r.GetString(1), r.GetString(2),
                        r.GetBoolean(3), r.GetBoolean(4),
                        r.GetInt64(5), r.IsDBNull(6) ? null : r.GetInt64(6),
                        r.IsDBNull(7) ? null : r.GetString(7));
    }

    public void Destroy(string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return;
        using var cn = _db.Open();
        using var cmd = cn.CreateCommand();
        cmd.CommandText = "DELETE FROM sessions WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", sessionId);
        cmd.ExecuteNonQuery();
    }

    public static void SetCookie(HttpContext ctx, string sessionId) =>
        ctx.Response.Cookies.Append(CookieName, sessionId, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            // Not ctx.Request.IsHttps: behind the router that is false even
            // though the browser is on TLS, which would ship the session cookie
            // without its Secure flag. See PublicUrl.
            Secure = PublicUrl.IsSecure(ctx),
            Path = "/",
            MaxAge = Lifetime,
        });

    public static void ClearCookie(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
}
