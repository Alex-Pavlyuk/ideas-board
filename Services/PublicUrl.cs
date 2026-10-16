namespace IdeasBoard.Services;

/// <summary>
/// Where this application actually lives, as the outside world sees it.
///
/// Behind the router the container is reached over plain http, and the client's
/// scheme does not survive the hop: X-Forwarded-Proto arrives as http, or not at
/// all — verified against production, where even a hand-sent
/// <c>X-Forwarded-Proto: https</c> came out as http. So Request.Scheme and
/// Request.IsHttps both lie, and trusting them costs two real things:
///
///   * the session cookie loses its Secure flag, so a browser would be willing
///     to send it in clear text;
///   * GitLab is handed an <c>http://</c> redirect_uri, and OAuth compares that
///     string exactly against the registered one — so sign-in fails outright.
///
/// The host decides instead: anything that is not a loopback name is fronted by
/// the TLS proxy. PUBLIC_ORIGIN overrides the lot for a deployment that differs.
/// </summary>
public static class PublicUrl
{
    public static bool IsSecure(HttpContext ctx) =>
        ctx.Request.IsHttps || !IsLoopback(ctx.Request.Host.Host);

    public static string Origin(HttpContext ctx, IConfiguration config)
    {
        var configured = config["PUBLIC_ORIGIN"];
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        return $"{(IsSecure(ctx) ? "https" : "http")}://{ctx.Request.Host}";
    }

    private static bool IsLoopback(string host) =>
        host is "localhost" or "127.0.0.1" or "[::1]" or "::1"
        || host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase);
}
