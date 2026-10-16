// ---------------------------------------------------------------------------
// Ideas board — ASP.NET Core Minimal API (.NET 10) over a single SQLite file.
//
// The board itself is NOT server-rendered: it is a static TypeScript bundle in
// wwwroot/app that talks to this API. Dragging a few hundred sticky notes has
// to stay a client-side, 60fps affair, which rules out a server-round-trip UI
// model (Blazor Server) for this particular screen.
//
// Binding comes from ASPNETCORE_URLS (the Dockerfile sets http://0.0.0.0:8080);
// TLS is terminated by the reverse proxy in front of the container.
// ---------------------------------------------------------------------------
using System.Threading.RateLimiting;
using IdeasBoard.Api;
using IdeasBoard.Data;
using IdeasBoard.Services;
using Microsoft.AspNetCore.HttpOverrides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<UserStore>();
builder.Services.AddSingleton<IdeaStore>();
builder.Services.AddSingleton<EventLog>();
builder.Services.AddSingleton<AnalyticsStore>();
builder.Services.AddSingleton<SessionStore>();
builder.Services.AddSingleton<LoginGuard>();
// Sign-in through a GitLab instance. Inert until GITLAB_* is configured —
// see Services/GitLabOAuth.cs and the "Вхід через GitLab" section of README.
builder.Services.AddSingleton<GitLabOAuth>();
builder.Services.AddHttpClient(nameof(GitLabOAuth), client =>
{
    client.Timeout = TimeSpan.FromSeconds(15);
    client.DefaultRequestHeaders.Accept.Add(new("application/json"));
});
builder.Services.AddSingleton<BoardHub>();
builder.Services.AddHostedService<Housekeeping>();

// A flood guard only: it caps the request rate from one address so nothing can
// hammer the endpoint, while LoginGuard does the precise per-account backoff.
// Kept loose because ten managers share one office address.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
});

// The reverse proxy terminates TLS; without this the session cookie never gets
// its Secure flag and redirects would come back as http://.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

var db = app.Services.GetRequiredService<Db>();
app.Logger.LogInformation("Postgres datastore: {Target}", db.Describe);

// The database is a separate process, so it can be a few seconds behind us
// after a reboot. Crashing here is the worst possible reaction: an orchestrator
// that removes a container which failed to start takes the log explaining WHY
// along with it. Retry for half a minute, then start anyway — a running process
// can be asked what is wrong (/api/health, the container log); a deleted one
// cannot.
var deadline = DateTime.UtcNow.AddSeconds(30);
while (true)
{
    try
    {
        db.Migrate();
        Bootstrap.EnsureAdmin(app.Services, app.Configuration, app.Logger);
        break;
    }
    catch (Exception e)
    {
        if (DateTime.UtcNow >= deadline)
        {
            app.Logger.LogError(e, "Database unreachable at {Target}. Starting without it: the board will not work, "
                                 + "but /api/health says so and this log survives.", db.Describe);
            break;
        }
        app.Logger.LogWarning("Database not ready yet ({Reason}); retrying", e.Message);
        Thread.Sleep(TimeSpan.FromSeconds(2));
    }
}

// The bundle filenames are not content-hashed, so a long max-age would leave
// browsers on the previous deploy's JavaScript for an hour. "no-cache" still
// caches — it just revalidates, and an unchanged bundle costs a 304.
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? "";
        var revalidate = path.StartsWith("/app/", StringComparison.OrdinalIgnoreCase)
                      || path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
                      || path.EndsWith('/');
        ctx.Context.Response.Headers.CacheControl = revalidate
            ? "no-cache"
            : "public, max-age=86400";
    }
});

app.UseRateLimiter();
app.UseMiddleware<AuthMiddleware>();

AuthApi.Map(app);
BoardApi.Map(app);
AdminApi.Map(app);

// `persisted` answers the one question a redeploy raises: did the data survive,
// or are we looking at an empty board again? False here means the schema was
// created by this very process.
var bootedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
app.MapGet("/api/health", (Db store) =>
{
    // Still 200 when the database is down: this endpoint is the diagnosis, and
    // a non-200 would only make the deploy fail with the reason hidden again.
    var error = store.ConnectionError();
    return Results.Json(new
    {
        status = error is null ? "ok" : "degraded",
        database = error is null ? "ok" : error,
        persisted = store.ExistedAtBoot,
        bootedAt,
    });
});

app.Run();
