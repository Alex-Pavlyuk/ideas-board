using System.Security.Cryptography;

namespace IdeasBoard.Services;

/// <summary>
/// PBKDF2-HMAC-SHA256. Chosen over Argon2/bcrypt purely because it ships in the
/// BCL: no native dependency to carry into the container for ten accounts.
/// Format: <c>pbkdf2$sha256$&lt;iterations&gt;$&lt;salt-b64&gt;$&lt;hash-b64&gt;</c>.
/// </summary>
public static class PasswordHasher
{
    private const int Iterations = 210_000;   // OWASP 2023 guidance for PBKDF2-SHA256
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"pbkdf2$sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 5 || parts[0] != "pbkdf2" || parts[1] != "sha256") return false;
        if (!int.TryParse(parts[2], out var iterations) || iterations <= 0) return false;

        byte[] salt, expected;
        try
        {
            salt = Convert.FromBase64String(parts[3]);
            expected = Convert.FromBase64String(parts[4]);
        }
        catch (FormatException) { return false; }

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    /// <summary>Readable one-off password for a freshly created account.</summary>
    public static string GenerateReadable(int words = 3)
    {
        // Deliberately small, unambiguous alphabet: these get pasted into chat.
        const string alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
        var chunks = new string[words];
        for (var i = 0; i < words; i++)
        {
            var buf = new char[4];
            for (var j = 0; j < buf.Length; j++) buf[j] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
            chunks[i] = new string(buf);
        }
        return string.Join('-', chunks);
    }
}
