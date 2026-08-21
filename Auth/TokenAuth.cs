using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Data;
using MiniSpace.Models;

namespace MiniSpace.Auth;

public static class TokenAuth
{
    public static string Hash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    public static string? GetToken(string? authHeader)
    {
        if (string.IsNullOrWhiteSpace(authHeader) ||
            !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return null;

        var token = authHeader["Bearer ".Length..].Trim();
        return string.IsNullOrEmpty(token) ? null : token;
    }

    public static async Task<User?> AuthenticateAsync(AppDbContext db, string? authHeader)
    {
        var token = GetToken(authHeader);
        if (token is null)
            return null;

        var hash = Hash(token);
        return await db.Users.FirstOrDefaultAsync(u => u.TokenHash == hash);
    }
}
