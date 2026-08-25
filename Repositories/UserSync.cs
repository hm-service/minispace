using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Common;
using MiniSpace.Models;

namespace MiniSpace.Repositories;

public static class UserSync
{
    private sealed record UserEntry(string? UserId, string? Nickname, string? Token);

    /// <summary>
    /// 将 DATA_DIR/users.json 与 user 表对齐：文件不存在则不做任何事；
    /// 按 userId upsert（存在则盲写 nickname/token_hash，不存在则插入），不删除 json 中缺失的用户。
    /// </summary>
    public static async Task SyncAsync(AppDbContext db, string path, ILoggerFactory loggerFactory)
    {
        if (!File.Exists(path))
        {
            return;
        }

        var logger = loggerFactory.CreateLogger(typeof(UserSync));

        List<UserEntry> entries;
        try
        {
            var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            entries = JsonSerializer.Deserialize<List<UserEntry>>(
                await File.ReadAllTextAsync(path), options) ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning("users.sync failed: {message}", ex.Message);
            return;
        }

        var seen = new HashSet<string>();
        var inserted = 0;
        var updated = 0;

        foreach (var e in entries)
        {
            if (string.IsNullOrWhiteSpace(e.UserId) ||
                string.IsNullOrWhiteSpace(e.Nickname) ||
                string.IsNullOrWhiteSpace(e.Token))
            {
                logger.LogWarning("users.sync skip invalid entry: {userId}", e.UserId);
                continue;
            }
            if (!e.Token.All(c => c <= 0x7F))
            {
                logger.LogWarning("users.sync skip non-ascii token: {userId}", e.UserId);
                continue;
            }
            if (!seen.Add(e.UserId))
            {
                logger.LogWarning("users.sync skip duplicate userId: {userId}", e.UserId);
                continue;
            }

            var user = await db.Users.FirstOrDefaultAsync(u => u.UserId == e.UserId);
            if (user is null)
            {
                db.Users.Add(new User
                {
                    UserId = e.UserId,
                    Nickname = e.Nickname,
                    TokenHash = TokenAuth.Hash(e.Token)
                });
                inserted++;
            }
            else
            {
                user.Nickname = e.Nickname;
                user.TokenHash = TokenAuth.Hash(e.Token);
                updated++;
            }
        }

        if (inserted > 0 || updated > 0)
        {
            await db.SaveChangesAsync();
            logger.LogInformation("users.sync inserted={inserted} updated={updated}", inserted, updated);
        }
    }
}
