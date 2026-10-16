using IdeasBoard.Data;

namespace IdeasBoard.Services;

/// <summary>
/// Daily log retention. This is the other half of "log a lot without ending up
/// with a gigabyte": raw rows expire, <c>event_daily</c> and <c>board_visits</c>
/// stay, so trend data is preserved at a fixed, tiny cost per day.
/// </summary>
public sealed class Housekeeping(EventLog log, LoginGuard guard, IConfiguration config,
                                ILogger<Housekeeping> logger)
    : BackgroundService
{
    public const int DefaultRetentionDays = 365;

    public static int RetentionDays(IConfiguration config) =>
        int.TryParse(config["LOG_RETENTION_DAYS"], out var d) && d > 0 ? d : DefaultRetentionDays;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Let the app finish starting before touching the database.
        try { await Task.Delay(TimeSpan.FromMinutes(1), ct); } catch (OperationCanceledException) { return; }

        using var timer = new PeriodicTimer(TimeSpan.FromHours(24));
        do
        {
            try
            {
                var days = RetentionDays(config);
                var deleted = log.Prune(days);
                if (deleted > 0) logger.LogInformation("Pruned {Count} events older than {Days} days", deleted, days);
                // Spent failed-login counters: expired, quiet, counting toward nothing.
                guard.Prune();
            }
            catch (Exception e)
            {
                // Housekeeping must never take the board down with it.
                logger.LogError(e, "Log housekeeping failed");
            }
        }
        while (await timer.WaitForNextTickAsync(ct));
    }
}
