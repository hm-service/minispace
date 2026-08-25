using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MiniSpace.Repositories;

namespace MiniSpace.Common;

public static class TokenAuthDefaults
{
    public static readonly string Scheme = "Token";
}

public static class TokenAuth
{
    public static string Hash(string token)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();
    }

    public static string? GetToken(string? authHeader)
    {
        if (string.IsNullOrWhiteSpace(authHeader)
            || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authHeader["Bearer ".Length..].Trim();
        return string.IsNullOrEmpty(token) ? null : token;
    }
}

public static class ClaimsPrincipalExtensions
{
    extension(ClaimsPrincipal user)
    {
        public string UserId => user.FindFirstValue(ClaimTypes.NameIdentifier) ?? string.Empty;

        public string Nickname => user.FindFirstValue(ClaimTypes.Name) ?? string.Empty;
    }
}

public sealed class TokenAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    AppDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    private readonly AppDbContext _db = db;

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = TokenAuth.GetToken(Request.Headers.Authorization);
        if (token is null)
        {
            return AuthenticateResult.NoResult();
        }

        var user = await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.TokenHash == TokenAuth.Hash(token));
        if (user is null)
        {
            return AuthenticateResult.Fail("invalid token");
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, user.UserId),
            new Claim(ClaimTypes.Name, user.Nickname)
        ], Scheme.Name);

        return AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }
}
