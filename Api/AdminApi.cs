using IdeasBoard.Data;
using IdeasBoard.Services;

namespace IdeasBoard.Api;

public static class AdminApi
{
    public sealed record CreateUserRequest(string Email, string? Password, string? Name, bool IsAdmin);
    public sealed record PasswordRequest(string? Password);
    public sealed record ActiveRequest(bool Active);
    public sealed record RenameRequest(string Name);

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/admin").RequireUser(adminOnly: true);

        // --- users ----------------------------------------------------------
        g.MapGet("/users", (UserStore users, BoardHub hub, LoginGuard guard) =>
        {
            var online = hub.OnlineUserIds.ToHashSet();
            var locked = guard.LockedNow()
                .Where(l => l.Scope == LoginGuard.Scope.Account)
                .ToDictionary(l => l.Key, l => l, StringComparer.OrdinalIgnoreCase);

            return Results.Json(users.All().Select(u => new
            {
                id = u.Id,
                email = u.Email,
                name = u.DisplayName,
                isAdmin = u.IsAdmin,
                isActive = u.IsActive,
                createdAt = u.CreatedAt,
                lastSeenAt = u.LastSeenAt,
                online = online.Contains(u.Id),
                gitlab = u.GitLabUsername,
                lockedUntil = locked.TryGetValue(u.Email, out var l) ? l.Until : (long?)null,
                failedAttempts = locked.TryGetValue(u.Email, out var f) ? f.Failures : 0,
            }));
        });

        // Detaching an SSO identity: the account and its password survive, so
        // this is how you hand a board seat from one GitLab user to another.
        g.MapPost("/users/{id:long}/unlink-gitlab", (long id, HttpContext ctx, UserStore users, EventLog log) =>
        {
            var target = users.ById(id);
            if (target is null) return Results.Json(new { error = "not_found" }, statusCode: 404);
            if (target.GitLabUsername is null) return Results.Json(new { ok = true });

            users.UnlinkGitLab(id);
            log.Log(EventKind.GitLabLinked, ctx.User()!.Id, a: (int)id, b: 0, meta: target.GitLabUsername);
            return Results.Json(new { ok = true });
        });

        // Lets the administrator let someone back in without waiting out the
        // backoff — the escape hatch that makes locking safe to do at all.
        g.MapPost("/users/{id:long}/unlock", (long id, HttpContext ctx, UserStore users,
                                              LoginGuard guard, EventLog log) =>
        {
            var target = users.ById(id);
            if (target is null) return Results.Json(new { error = "not_found" }, statusCode: 404);
            guard.UnlockAccount(target.Email);
            log.Log(EventKind.UserUnlocked, ctx.User()!.Id, a: (int)id, meta: target.Email);
            return Results.Json(new { ok = true });
        });

        g.MapPost("/users", (CreateUserRequest req, HttpContext ctx, UserStore users) =>
        {
            var email = req.Email?.Trim() ?? "";
            if (!email.Contains('@') || email.Length < 3)
                return Results.Json(new { error = "bad_email" }, statusCode: 400);

            // Blank password means "generate one" — it is returned once, here,
            // and is unrecoverable afterwards because only the hash is stored.
            var password = string.IsNullOrWhiteSpace(req.Password)
                ? PasswordHasher.GenerateReadable(PasswordPolicy.GeneratedGroups(req.IsAdmin))
                : req.Password;

            var weakness = PasswordPolicy.Check(password, req.IsAdmin, email);
            if (weakness is not null) return Results.Json(new { error = weakness }, statusCode: 400);

            var user = users.Create(email, password, req.Name ?? "", req.IsAdmin, ctx.User()!.Id);
            if (user is null) return Results.Json(new { error = "email_taken" }, statusCode: 409);

            return Results.Json(new
            {
                id = user.Id,
                email = user.Email,
                name = user.DisplayName,
                isAdmin = user.IsAdmin,
                isActive = user.IsActive,
                password,
            });
        });

        g.MapPost("/users/{id:long}/password", (long id, PasswordRequest req, HttpContext ctx, UserStore users) =>
        {
            // The bar depends on the account being reset, not on who is resetting it.
            var target = users.ById(id);
            if (target is null) return Results.Json(new { error = "not_found" }, statusCode: 404);

            var password = string.IsNullOrWhiteSpace(req.Password)
                ? PasswordHasher.GenerateReadable(PasswordPolicy.GeneratedGroups(target.IsAdmin))
                : req.Password;

            var weakness = PasswordPolicy.Check(password, target.IsAdmin, target.Email);
            if (weakness is not null) return Results.Json(new { error = weakness }, statusCode: 400);

            if (!users.SetPassword(id, password, ctx.User()!.Id))
                return Results.Json(new { error = "not_found" }, statusCode: 404);
            return Results.Json(new { ok = true, password });
        });

        g.MapPost("/users/{id:long}/active", (long id, ActiveRequest req, HttpContext ctx, UserStore users) =>
        {
            // Locking yourself out would leave the board with no administrator.
            if (id == ctx.User()!.Id && !req.Active)
                return Results.Json(new { error = "cannot_disable_self" }, statusCode: 400);
            if (!users.SetActive(id, req.Active, ctx.User()!.Id))
                return Results.Json(new { error = "not_found" }, statusCode: 404);
            return Results.Json(new { ok = true });
        });

        g.MapPost("/users/{id:long}/name", (long id, RenameRequest req, UserStore users) =>
            users.Rename(id, req.Name ?? "")
                ? Results.Json(new { ok = true })
                : Results.Json(new { error = "not_found" }, statusCode: 404));

        g.MapDelete("/users/{id:long}", (long id, HttpContext ctx, UserStore users) =>
        {
            var me = ctx.User()!;
            if (id == me.Id) return Results.Json(new { error = "cannot_delete_self" }, statusCode: 400);
            // Their ideas stay on the board and are reassigned to the admin doing
            // the deleting — the board is the team's memory, not personal property.
            return users.Delete(id, me.Id)
                ? Results.Json(new { ok = true })
                : Results.Json(new { error = "not_found" }, statusCode: 404);
        });

        // --- ideas (table view, hard delete lives in BoardApi) ---------------
        g.MapGet("/ideas", (IdeaStore ideas) => Results.Json(ideas.All().Select(BoardApi.Dto)));

        // --- activity log ---------------------------------------------------
        g.MapGet("/events", (int? kind, long? userId, long? from, long? to, long? before, int? limit,
                             AnalyticsStore analytics) =>
        {
            var rows = analytics.Events(kind, userId, from, to, before, limit ?? 100);
            return Results.Json(new
            {
                events = rows.Select(e => new
                {
                    id = e.Id, ts = e.Ts, kind = e.Kind,
                    userId = e.UserId, user = e.UserName,
                    ideaId = e.IdeaId, idea = e.IdeaText,
                    a = e.A, b = e.B, meta = e.Meta,
                }),
                // Cursor for the next page; null once the log is exhausted.
                nextBefore = rows.Count > 0 ? rows[^1].Id : (long?)null,
            });
        });

        g.MapGet("/stats", (long? since, int? days, AnalyticsStore analytics, IdeaStore ideas,
                            LoginGuard guard, IConfiguration config) =>
        {
            var storage = analytics.Storage();
            var locks = guard.LockedNow();
            return Results.Json(new
            {
                users = analytics.UserActivityBy(since),
                ideasByStatus = ideas.CountsByStatus(),
                daily = analytics.DailyTotals(days ?? 30).Select(d => new { day = d.Day, kind = d.Kind, count = d.Count }),
                storage = new
                {
                    events = storage.Events,
                    visits = storage.Visits,
                    bytes = storage.DbBytes,
                    oldestEventTs = storage.OldestEventTs,
                    retentionDays = Housekeeping.RetentionDays(config),
                },
                security = new
                {
                    failedLogins = analytics.CountOfKind((int)EventKind.LoginFailed, since),
                    lockouts = analytics.CountOfKind((int)EventKind.LoginLocked, since),
                    lockedAccounts = locks.Count(l => l.Scope == LoginGuard.Scope.Account),
                    blockedSources = locks.Count(l => l.Scope == LoginGuard.Scope.Source),
                },
            });
        });

        // Raw log export for the dashboard that may come later: NDJSON streams
        // without materialising the whole log in memory or in the browser.
        g.MapGet("/events/export.ndjson", async (HttpContext ctx, long? from, long? to, AnalyticsStore analytics) =>
        {
            ctx.Response.ContentType = "application/x-ndjson";
            ctx.Response.Headers.ContentDisposition = "attachment; filename=\"ideas-events.ndjson\"";

            long? before = null;
            while (true)
            {
                var page = analytics.Events(null, null, from, to, before, 500);
                if (page.Count == 0) break;
                foreach (var e in page)
                {
                    await ctx.Response.WriteAsync(System.Text.Json.JsonSerializer.Serialize(new
                    {
                        id = e.Id, ts = e.Ts, kind = e.Kind, userId = e.UserId,
                        user = e.UserName, ideaId = e.IdeaId, a = e.A, b = e.B, meta = e.Meta,
                    }) + "\n");
                }
                await ctx.Response.Body.FlushAsync();
                before = page[^1].Id;
            }
        });
    }
}
