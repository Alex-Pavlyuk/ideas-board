using IdeasBoard.Data;

namespace IdeasBoard.Services;

/// <summary>
/// First-run setup: the board needs one administrator before anyone can log in,
/// and there is no self-service registration by design.
/// </summary>
public static class Bootstrap
{
    public static void EnsureAdmin(IServiceProvider services, IConfiguration config, ILogger logger)
    {
        var users = services.GetRequiredService<UserStore>();
        if (users.Count() > 0) return;

        var email = config["ADMIN_EMAIL"];
        if (string.IsNullOrWhiteSpace(email)) email = "admin@local";

        var password = config["ADMIN_PASSWORD"];
        var supplied = !string.IsNullOrWhiteSpace(password);

        // A weak ADMIN_PASSWORD is not quietly accepted: this account can erase
        // any idea and read the whole activity log. Rather than refuse to boot
        // (which would leave a deploy with no way in), generate a strong one and
        // say loudly what happened.
        var rejected = supplied ? PasswordPolicy.Check(password!, isAdmin: true, email) : null;
        if (!supplied || rejected is not null) password = PasswordHasher.GenerateReadable(5);

        var admin = users.Create(email!, password!, "Admin", isAdmin: true, actorId: null);
        if (admin is null) return;

        // Printed once, at first boot, and never recoverable afterwards — only
        // the hash is stored.
        var note = rejected is not null
            ? $"   (ADMIN_PASSWORD rejected: {rejected} — generated instead; copy it now, it is not stored)"
            : supplied ? "" : "   (generated — copy it now, it is not stored)";

        logger.LogWarning(
            "Created the initial administrator.\n" +
            "    email:    {Email}\n" +
            "    password: {Password}{Note}",
            email, password, note);
    }
}
