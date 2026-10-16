namespace IdeasBoard.Services;

/// <summary>
/// The minimum bar for a password a person types in by hand.
///
/// Generated passwords sail past this — the rules exist for the ones someone
/// picks themselves. The administrator gets a higher bar than everyone else
/// because that account can hard-delete any idea and read the whole activity
/// log; it is the one credential worth attacking.
/// </summary>
public static class PasswordPolicy
{
    public const int MinLength = 10;
    public const int MinAdminLength = 14;

    /// <summary>
    /// Not a dictionary — just the handful anyone actually reaches for first.
    /// Matched after stripping digits and punctuation, so "Admin123!" is caught
    /// by the same entry as "admin".
    /// </summary>
    private static readonly HashSet<string> Common = new(StringComparer.OrdinalIgnoreCase)
    {
        "password", "passwd", "pass", "changeme", "letmein", "welcome", "secret",
        "admin", "administrator", "root", "user", "test", "demo", "temp",
        "qwerty", "qwertyuiop", "asdfgh", "iloveyou", "monkey", "dragon",
        "master", "sunshine", "football", "baseball", "princess", "shadow",
        // Add your own organisation and product names here: the name of the
        // thing you are signing in to is always among the first guesses.
        "ideas", "ideasboard", "board",
    };

    /// <summary>Null when the password is acceptable; otherwise the error code the API returns.</summary>
    public static string? Check(string password, bool isAdmin, string? email = null)
    {
        var minimum = isAdmin ? MinAdminLength : MinLength;
        if (password.Length < minimum) return "password_too_short";

        var letters = new string(password.Where(char.IsLetter).ToArray());
        if (letters.Length > 0 && Common.Contains(letters)) return "password_common";

        // "aaaaaaaaaaaa" and "ababababab" clear any length rule on their own.
        if (password.Distinct().Count() < 6) return "password_too_simple";
        if (IsRun(password)) return "password_too_simple";

        // A password built from the address it unlocks is the first guess after
        // the common list.
        var local = email?.Split('@')[0];
        if (!string.IsNullOrWhiteSpace(local) && local.Length >= 3
            && password.Contains(local, StringComparison.OrdinalIgnoreCase))
            return "password_contains_email";

        return null;
    }

    /// <summary>True for a straight run like "12345678" or "abcdefghij", up or down.</summary>
    private static bool IsRun(string s)
    {
        if (s.Length < 3) return false;
        var step = s[1] - s[0];
        if (step != 1 && step != -1) return false;
        for (var i = 2; i < s.Length; i++)
            if (s[i] - s[i - 1] != step) return false;
        return true;
    }

    /// <summary>Length the generator needs to clear the bar for this kind of account.</summary>
    public static int GeneratedGroups(bool isAdmin) => isAdmin ? 5 : 4;
}
