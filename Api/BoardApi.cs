using System.Text;
using IdeasBoard.Data;
using IdeasBoard.Services;

namespace IdeasBoard.Api;

public static class BoardApi
{
    /// <summary>Notes hold a headline, not a document — the UI cannot render more legibly than this.</summary>
    public const int MaxTextLength = 280;

    public sealed record CreateIdeaRequest(string Text, double X, double Y, double Angle);
    public sealed record StatusRequest(int Status);
    public sealed record PositionRequest(double X, double Y, double Angle);
    public sealed record TextRequest(string Text);

    public static void Map(IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").RequireUser();

        // --- board snapshot -------------------------------------------------
        g.MapGet("/board", (HttpContext ctx, IdeaStore ideas, EventLog log) =>
        {
            var user = ctx.User()!;
            // Opening the board is the signal for "who is actually interested",
            // so it is recorded here rather than at login.
            log.TouchVisit(user.Id);
            return Results.Json(new
            {
                me = AuthApi.Me(user),
                ideas = ideas.All().Select(Dto),
            });
        });

        // Keeps the current visit alive so time-on-board is measurable.
        // Coalesced server-side: a 40-minute session is still one row.
        g.MapPost("/board/beat", (HttpContext ctx, EventLog log, UserStore users) =>
        {
            var user = ctx.User()!;
            log.TouchVisit(user.Id);
            users.TouchLastSeen(user.Id);
            return Results.Json(new { ok = true });
        });

        // --- ideas ----------------------------------------------------------
        g.MapPost("/ideas", (CreateIdeaRequest req, HttpContext ctx, IdeaStore ideas, BoardHub hub) =>
        {
            var text = Clean(req.Text);
            if (text.Length == 0) return Results.Json(new { error = "empty_text" }, statusCode: 400);

            var idea = ideas.Create(text, req.X, req.Y, ClampAngle(req.Angle), ctx.User()!.Id);
            hub.Publish("idea.created", Dto(idea), Origin(ctx));
            return Results.Json(Dto(idea));
        });

        g.MapPatch("/ideas/{id:long}/status", (long id, StatusRequest req, HttpContext ctx,
                                               IdeaStore ideas, BoardHub hub) =>
        {
            if (!Enum.IsDefined(typeof(IdeaStatus), req.Status))
                return Results.Json(new { error = "bad_status" }, statusCode: 400);

            var result = ideas.SetStatus(id, req.Status, ctx.User()!.Id);
            if (result is null) return Results.Json(new { error = "not_found" }, statusCode: 404);

            hub.Publish("idea.updated", Dto(result.Value.Idea), Origin(ctx));
            return Results.Json(Dto(result.Value.Idea));
        });

        // Deliberately unlogged. Dragging a note is how the board is read, not a
        // decision anyone needs to answer for later, and it is the one action a
        // single sitting repeats dozens of times — logging it buries the events
        // that do matter. `EventKind.IdeaMoved` stays defined for rows written
        // before this.
        g.MapPatch("/ideas/{id:long}/position", (long id, PositionRequest req, HttpContext ctx,
                                                 IdeaStore ideas, BoardHub hub) =>
        {
            var existing = ideas.ById(id);
            if (existing is null) return Results.Json(new { error = "not_found" }, statusCode: 404);
            // A buried idea stays where it was laid to rest. The board already
            // refuses to drag one; enforcing it here keeps the rule true even
            // when a note is buried mid-drag from another tab.
            if (existing.Status == (int)IdeaStatus.Buried)
                return Results.Json(new { error = "idea_buried" }, statusCode: 409);

            if (!ideas.Move(id, req.X, req.Y, ClampAngle(req.Angle)))
                return Results.Json(new { error = "not_found" }, statusCode: 404);

            hub.Publish("idea.moved", new { id, x = req.X, y = req.Y, angle = ClampAngle(req.Angle) }, Origin(ctx));
            return Results.Json(new { ok = true });
        });

        g.MapPatch("/ideas/{id:long}/text", (long id, TextRequest req, HttpContext ctx,
                                             IdeaStore ideas, BoardHub hub) =>
        {
            var user = ctx.User()!;
            var existing = ideas.ById(id);
            if (existing is null) return Results.Json(new { error = "not_found" }, statusCode: 404);
            // Rewording someone else's idea would quietly rewrite the record;
            // the author and the admin are the only ones who may.
            if (existing.AuthorId != user.Id && !user.IsAdmin)
                return Results.Json(new { error = "forbidden" }, statusCode: 403);

            var text = Clean(req.Text);
            if (text.Length == 0) return Results.Json(new { error = "empty_text" }, statusCode: 400);

            var idea = ideas.EditText(id, text, user.Id);
            if (idea is null) return Results.Json(new { error = "not_found" }, statusCode: 404);
            hub.Publish("idea.updated", Dto(idea), Origin(ctx));
            return Results.Json(Dto(idea));
        });

        // Irreversible, admin only. Everyone else buries (status 5), which keeps
        // the note on the board greyed out.
        g.MapDelete("/ideas/{id:long}", (long id, HttpContext ctx, IdeaStore ideas, BoardHub hub) =>
        {
            if (!ideas.Delete(id, ctx.User()!.Id))
                return Results.Json(new { error = "not_found" }, statusCode: 404);
            hub.Publish("idea.deleted", new { id }, Origin(ctx));
            return Results.Json(new { ok = true });
        }).RequireUser(adminOnly: true);

        // --- live stream ----------------------------------------------------
        g.MapGet("/board/stream", async (HttpContext ctx, BoardHub hub,
                                         IHostApplicationLifetime lifetime, CancellationToken requestAborted) =>
        {
            var user = ctx.User()!;

            // An SSE response never completes on its own, so on shutdown it
            // counts as a request still in flight and the host waits out its
            // full timeout before exiting — a 30-second stall on every deploy.
            // Ending the stream when the application starts stopping avoids it;
            // EventSource reconnects to the new instance by itself.
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(
                requestAborted, lifetime.ApplicationStopping);
            var ct = linked.Token;
            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache, no-transform";
            ctx.Response.Headers.Connection = "keep-alive";
            // nginx buffers proxied responses by default, which would hold every
            // frame until the connection closes.
            ctx.Response.Headers["X-Accel-Buffering"] = "no";

            var (id, reader) = hub.Subscribe(user.Id);
            try
            {
                await ctx.Response.WriteAsync(": connected\n\n", ct);
                await ctx.Response.Body.FlushAsync(ct);

                // A comment frame every 25s keeps idle proxies from reaping the
                // connection; EventSource reconnects on its own if one dies.
                using var heartbeat = new PeriodicTimer(TimeSpan.FromSeconds(25));
                var beat = HeartbeatLoop(ctx, heartbeat, ct);

                await foreach (var frame in reader.ReadAllAsync(ct))
                {
                    await ctx.Response.WriteAsync($"data: {frame}\n\n", ct);
                    await ctx.Response.Body.FlushAsync(ct);
                }
                await beat;
            }
            catch (OperationCanceledException) { /* client navigated away */ }
            finally { hub.Unsubscribe(id); }
        });
    }

    private static async Task HeartbeatLoop(HttpContext ctx, PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
            {
                await ctx.Response.WriteAsync(": ping\n\n", ct);
                await ctx.Response.Body.FlushAsync(ct);
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { /* socket already gone */ }
    }

    /// <summary>Per-tab id, echoed back on the stream so the tab that made a change ignores its own frame.</summary>
    private static string? Origin(HttpContext ctx) => ctx.Request.Headers["X-Origin-Id"].FirstOrDefault();

    private static string Clean(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        // Collapse the runaway blank lines that come from pasting, keep single ones.
        var normalised = text.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        var sb = new StringBuilder(normalised.Length);
        var newlines = 0;
        foreach (var c in normalised)
        {
            if (c == '\n') { if (++newlines > 2) continue; }
            else newlines = 0;
            sb.Append(c);
        }
        var result = sb.ToString();
        return result.Length > MaxTextLength ? result[..MaxTextLength] : result;
    }

    private static double ClampAngle(double angle) => Math.Clamp(double.IsFinite(angle) ? angle : 0, -20, 20);

    public static object Dto(Idea i) => new
    {
        id = i.Id,
        text = i.Text,
        status = i.Status,
        x = i.X,
        y = i.Y,
        angle = i.Angle,
        authorId = i.AuthorId,
        author = i.AuthorName,
        // Shown in the note's menu: on a ten-person board, knowing who to walk
        // over and ask is the point of attribution.
        authorEmail = i.AuthorEmail,
        createdAt = i.CreatedAt,
        updatedAt = i.UpdatedAt,
    };
}
