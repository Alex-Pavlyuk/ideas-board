using IdeasBoard.Data;
using IdeasBoard.Services;

namespace IdeasBoard.Api;

public static class AuthApi
{
    public sealed record LoginRequest(string Email, string Password);

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/auth");

        g.MapPost("/login", (LoginRequest req, HttpContext ctx, UserStore users,
                             SessionStore sessions, EventLog log, LoginGuard guard) =>
        {
            var email = req.Email?.Trim() ?? "";
            if (email.Length == 0 || string.IsNullOrEmpty(req.Password))
                return Results.Json(new { error = "missing_credentials" }, statusCode: 400);

            var source = SourceOf(ctx);

            // Checked before the password is verified: a blocked attempt should
            // cost the attacker a round trip, not 210 000 PBKDF2 iterations of
            // our CPU. It also means a correct password cannot open a locked
            // account, which is the whole point of the lock.
            var blocked = guard.CurrentBlock(email, source);
            if (blocked is not null) return TooManyAttempts(ctx, blocked);

            var user = users.Authenticate(email, req.Password);
            if (user is null)
            {
                var triggered = guard.RecordFailure(email, source);
                // The email is logged, the password never is. Failed attempts are
                // what make a brute-force visible in the admin log.
                log.Log(EventKind.LoginFailed, meta: email);

                if (triggered is not null)
                {
                    log.Log(EventKind.LoginLocked, a: triggered.RetryAfterSeconds,
                            b: (int)triggered.Scope, meta: email);
                    return TooManyAttempts(ctx, triggered);
                }
                return Results.Json(new { error = "invalid_credentials" }, statusCode: 401);
            }

            guard.RecordSuccess(email);
            SessionStore.SetCookie(ctx, sessions.Create(user.Id));
            users.TouchLastSeen(user.Id);
            log.Log(EventKind.LoginSuccess, user.Id);
            return Results.Json(Me(user));
        }).RequireRateLimiting("login");

        g.MapPost("/logout", (HttpContext ctx, SessionStore sessions, EventLog log) =>
        {
            var user = ctx.User();
            if (user is not null) log.Log(EventKind.Logout, user.Id);
            sessions.Destroy(ctx.Request.Cookies[SessionStore.CookieName]);
            SessionStore.ClearCookie(ctx);
            return Results.Json(new { ok = true });
        });

        // ------------------------------------------------------------ GitLab

        // Lets the sign-in screen decide whether to draw the GitLab button at
        // all, rather than offering a route that would only fail.
        g.MapGet("/providers", (GitLabOAuth gitlab) =>
            Results.Json(new { gitlab = gitlab.IsConfigured }));

        g.MapGet("/gitlab", (HttpContext ctx, GitLabOAuth gitlab) =>
        {
            if (!gitlab.IsConfigured) return Results.Redirect("/?sso=unconfigured");

            var state = GitLabOAuth.NewState();
            GitLabOAuth.SetStateCookie(ctx, state);
            return Results.Redirect(gitlab.AuthorizeUrl(ctx, state));
        });

        // A browser lands here, not fetch(), so every outcome is a redirect back
        // to the sign-in screen with ?sso=<reason> for it to explain.
        g.MapGet("/gitlab/callback", async (HttpContext ctx, string? code, string? state, string? error,
                                            GitLabOAuth gitlab, UserStore users, SessionStore sessions,
                                            LoginGuard guard, EventLog log, CancellationToken ct) =>
        {
            if (!gitlab.IsConfigured) return Results.Redirect("/?sso=unconfigured");
            if (!string.IsNullOrEmpty(error)) return Fail(ctx, log, "denied", error);
            if (!GitLabOAuth.ValidateState(ctx, state)) return Fail(ctx, log, "state");
            if (string.IsNullOrEmpty(code)) return Fail(ctx, log, "exchange");

            var token = await gitlab.ExchangeCodeAsync(ctx, code, ct);
            if (token is null) return Fail(ctx, log, "exchange");

            var profile = await gitlab.FetchProfileAsync(token, ct);
            if (profile is null) return Fail(ctx, log, "profile");
            if (!profile.Active) return Fail(ctx, log, "inactive", profile.Username);

            // 1. Already linked — the normal case after the first sign-in.
            var user = users.ByGitLabId(profile.Id);

            // 2. Not linked yet: adopt the account that already owns this address.
            //    This is what makes SSO work for accounts the administrator
            //    created by hand, without anyone linking anything manually.
            if (user is null && profile.Email.Length > 0)
            {
                var match = users.ByAnyEmail(profile.Email);
                if (match is not null)
                {
                    if (!users.LinkGitLab(match.Id, profile.Id, profile.Username, profile.Email))
                        return Fail(ctx, log, "link_taken", profile.Username);
                    user = users.ById(match.Id);
                }
            }

            // 3. Still nothing. A portal-style integration would create an
            //    account here; this board only does so when explicitly told to,
            //    because its access model is "the administrator issues accounts".
            if (user is null && gitlab.AutoCreate && profile.Email.Length > 0)
            {
                if (!gitlab.IsDomainAllowed(profile.Email)) return Fail(ctx, log, "domain", profile.Email);
                user = users.CreateFromGitLab(profile.Email, profile.Name, profile.Id, profile.Username);
            }

            if (user is null) return Fail(ctx, log, "no_account", profile.Email.Length > 0 ? profile.Email : profile.Username);
            if (!user.IsActive) return Fail(ctx, log, "disabled", user.Email);

            // GitLab has just proved who this is, so the password backoff has
            // nothing left to protect: clear it rather than leaving the real
            // owner locked out by someone else's guessing.
            guard.RecordSuccess(user.Email);
            SessionStore.SetCookie(ctx, sessions.Create(user.Id));
            users.TouchLastSeen(user.Id);
            log.Log(EventKind.LoginGitLab, user.Id, meta: profile.Username);
            return Results.Redirect("/");
        });

        g.MapGet("/me", (HttpContext ctx) =>
        {
            var user = ctx.User();
            return user is null
                ? Results.Json(new { error = "unauthorized" }, statusCode: 401)
                : Results.Json(Me(user));
        });
    }

    /// <summary>
    /// Every SSO dead end is logged and then handed back to the sign-in screen
    /// as ?sso=&lt;reason&gt;. Failures are logged as ordinary failed sign-ins so a
    /// misconfigured or probed SSO route shows up in the same place as the rest.
    /// </summary>
    private static IResult Fail(HttpContext ctx, EventLog log, string reason, string? detail = null)
    {
        GitLabOAuth.ClearStateCookie(ctx);
        log.Log(EventKind.LoginFailed, meta: detail is null ? $"gitlab:{reason}" : $"gitlab:{reason} {detail}");
        return Results.Redirect($"/?sso={reason}");
    }

    /// <summary>
    /// UseForwardedHeaders has already rewritten this from X-Forwarded-For, so
    /// behind the router it is the real client address rather than the proxy.
    /// </summary>
    private static string SourceOf(HttpContext ctx) =>
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static IResult TooManyAttempts(HttpContext ctx, LoginGuard.Block block)
    {
        // Retry-After is what lets the form count down instead of guessing.
        ctx.Response.Headers.RetryAfter = block.RetryAfterSeconds.ToString();
        return Results.Json(
            new { error = "too_many_attempts", retryAfter = block.RetryAfterSeconds },
            statusCode: StatusCodes.Status429TooManyRequests);
    }

    public static object Me(User u) => new
    {
        id = u.Id,
        email = u.Email,
        name = u.DisplayName,
        isAdmin = u.IsAdmin,
    };
}
