using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json.Serialization;

namespace IdeasBoard.Services;

/// <summary>
/// Sign-in through a GitLab instance: authorization-code flow, CSRF-protected
/// by a one-shot <c>state</c>, then <c>/api/v4/user</c> for the profile.
///
/// One deliberate difference from the usual portal-style integration lives in
/// <see cref="AutoCreate"/>. A portal provisions an account for anyone who
/// signs in, because everyone who can sign in belongs there. This board is for
/// ten people and its whole access model is "the administrator issues
/// accounts", so by default GitLab only *links to* an account that already
/// exists. Set GITLAB_AUTO_CREATE=true for the provisioning behaviour.
/// </summary>
public sealed class GitLabOAuth(IConfiguration config, IHttpClientFactory httpFactory,
                                ILogger<GitLabOAuth> logger)
{
    public const string StateCookie = "ib_gl_state";
    private const string CallbackPath = "/api/auth/gitlab/callback";

    /// <summary>Enough to read the signed-in user's own profile, and nothing more.</summary>
    private const string Scope = "read_user";

    private readonly string _baseUrl = (config["GITLAB_URL"] ?? "").TrimEnd('/');
    private readonly string _clientId = config["GITLAB_CLIENT_ID"] ?? "";
    private readonly string _clientSecret = config["GITLAB_CLIENT_SECRET"] ?? "";
    private readonly string _configuredRedirect = config["GITLAB_REDIRECT_URI"] ?? "";

    public bool IsConfigured =>
        _baseUrl.Length > 0 && _clientId.Length > 0 && _clientSecret.Length > 0;

    /// <summary>Off unless explicitly enabled — see the class remarks.</summary>
    public bool AutoCreate =>
        bool.TryParse(config["GITLAB_AUTO_CREATE"], out var on) && on;

    /// <summary>Optional comma-separated email domains that auto-creation is limited to.</summary>
    public string[] AllowedDomains =>
        (config["GITLAB_ALLOWED_DOMAINS"] ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public bool IsDomainAllowed(string email)
    {
        var domains = AllowedDomains;
        if (domains.Length == 0) return true;
        var at = email.LastIndexOf('@');
        if (at < 0) return false;
        var domain = email[(at + 1)..];
        return domains.Any(d => string.Equals(d, domain, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// GITLAB_REDIRECT_URI wins; otherwise it is derived from the public origin,
    /// which is what makes this work on localhost with no configuration at all.
    /// It must match the callback registered on the GitLab application exactly —
    /// scheme included, which is why the origin comes from PublicUrl and not
    /// from Request.Scheme. See PublicUrl for what goes wrong otherwise.
    /// </summary>
    public string RedirectUri(HttpContext ctx) =>
        _configuredRedirect.Length > 0
            ? _configuredRedirect
            : PublicUrl.Origin(ctx, config) + CallbackPath;

    public static string NewState() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public string AuthorizeUrl(HttpContext ctx, string state)
    {
        var query = new Dictionary<string, string?>
        {
            ["client_id"] = _clientId,
            ["redirect_uri"] = RedirectUri(ctx),
            ["response_type"] = "code",
            ["state"] = state,
            ["scope"] = Scope,
        };
        return Microsoft.AspNetCore.WebUtilities.QueryHelpers.AddQueryString(
            $"{_baseUrl}/oauth/authorize", query);
    }

    public sealed record Profile(string Id, string Username, string Email, string Name, bool Active);

    private sealed record TokenResponse([property: JsonPropertyName("access_token")] string? AccessToken);

    private sealed record UserResponse(
        long Id,
        string? Username,
        string? Email,
        string? Name,
        string? State);

    public async Task<string?> ExchangeCodeAsync(HttpContext ctx, string code, CancellationToken ct)
    {
        var client = httpFactory.CreateClient(nameof(GitLabOAuth));
        using var body = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _clientId,
            ["client_secret"] = _clientSecret,
            ["code"] = code,
            ["grant_type"] = "authorization_code",
            ["redirect_uri"] = RedirectUri(ctx),
        });

        try
        {
            using var response = await client.PostAsync($"{_baseUrl}/oauth/token", body, ct);
            if (!response.IsSuccessStatusCode)
            {
                // The body carries GitLab's reason (bad redirect_uri, expired code…).
                logger.LogWarning("GitLab token exchange failed: {Status} {Body}",
                    (int)response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return null;
            }
            var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: ct);
            return string.IsNullOrEmpty(token?.AccessToken) ? null : token.AccessToken;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(e, "GitLab token exchange could not reach {Url}", _baseUrl);
            return null;
        }
    }

    public async Task<Profile?> FetchProfileAsync(string accessToken, CancellationToken ct)
    {
        var client = httpFactory.CreateClient(nameof(GitLabOAuth));
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/api/v4/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        try
        {
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("GitLab profile fetch failed: {Status}", (int)response.StatusCode);
                return null;
            }
            var user = await response.Content.ReadFromJsonAsync<UserResponse>(cancellationToken: ct);
            if (user is null || user.Id == 0) return null;

            return new Profile(
                user.Id.ToString(),
                user.Username ?? "",
                user.Email?.Trim() ?? "",
                string.IsNullOrWhiteSpace(user.Name) ? user.Username ?? "" : user.Name,
                // GitLab reports blocked/deactivated accounts here; they must not
                // get in just because the token is still technically valid.
                string.Equals(user.State, "active", StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(e, "GitLab profile fetch could not reach {Url}", _baseUrl);
            return null;
        }
    }

    /// <summary>
    /// The state lives in a short httpOnly cookie rather than server-side: there
    /// is no session yet at this point in the flow. SameSite must be Lax, not
    /// Strict, or the cookie would not survive the redirect back from GitLab.
    /// </summary>
    public static void SetStateCookie(HttpContext ctx, string state) =>
        ctx.Response.Cookies.Append(StateCookie, state, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = PublicUrl.IsSecure(ctx),
            Path = CallbackPath,
            MaxAge = TimeSpan.FromMinutes(10),
        });

    public static void ClearStateCookie(HttpContext ctx) =>
        ctx.Response.Cookies.Delete(StateCookie, new CookieOptions { Path = CallbackPath });

    /// <summary>One-shot, constant-time comparison of the returned state.</summary>
    public static bool ValidateState(HttpContext ctx, string? returned)
    {
        var expected = ctx.Request.Cookies[StateCookie];
        ClearStateCookie(ctx);
        if (string.IsNullOrEmpty(expected) || string.IsNullOrEmpty(returned)) return false;
        return CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(expected),
            System.Text.Encoding.UTF8.GetBytes(returned));
    }
}
