using IdeasBoard.Data;

namespace IdeasBoard.Services;

/// <summary>
/// Resolves the session cookie into a <see cref="User"/> on every request and
/// parks it in <c>HttpContext.Items</c>. Kept as plain middleware instead of an
/// AuthenticationHandler: there is exactly one scheme and two roles.
/// </summary>
public sealed class AuthMiddleware(RequestDelegate next)
{
    private const string ItemKey = "ib.user";

    public async Task Invoke(HttpContext ctx, SessionStore sessions)
    {
        var sid = ctx.Request.Cookies[SessionStore.CookieName];
        var user = sessions.Resolve(sid);
        if (user is not null) ctx.Items[ItemKey] = user;
        await next(ctx);
    }

    public static User? Current(HttpContext ctx) => ctx.Items.TryGetValue(ItemKey, out var u) ? u as User : null;
}

public static class AuthExtensions
{
    public static User? User(this HttpContext ctx) => AuthMiddleware.Current(ctx);

    /// <summary>
    /// Guards a route group. <paramref name="adminOnly"/> additionally requires
    /// the admin flag; both answer 401/403 as JSON so the client can react
    /// without parsing an HTML error page.
    /// </summary>
    public static RouteHandlerBuilder RequireUser(this RouteHandlerBuilder b, bool adminOnly = false) =>
        b.AddEndpointFilter(async (ctx, next) =>
        {
            var user = ctx.HttpContext.User();
            if (user is null) return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            if (adminOnly && !user.IsAdmin) return Results.Json(new { error = "forbidden" }, statusCode: 403);
            return await next(ctx);
        });

    public static RouteGroupBuilder RequireUser(this RouteGroupBuilder b, bool adminOnly = false) =>
        (RouteGroupBuilder)b.AddEndpointFilter(async (ctx, next) =>
        {
            var user = ctx.HttpContext.User();
            if (user is null) return Results.Json(new { error = "unauthorized" }, statusCode: 401);
            if (adminOnly && !user.IsAdmin) return Results.Json(new { error = "forbidden" }, statusCode: 403);
            return await next(ctx);
        });
}
