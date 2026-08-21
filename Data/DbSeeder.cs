using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Models;

namespace MiniSpace.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.Users.AnyAsync())
            return;

        db.Users.AddRange(
            new User
            {
                UserId = "10000000-0000-0000-0000-000000000001",
                Nickname = "小明",
                TokenHash = TokenAuth.Hash("demo-alice")
            },
            new User
            {
                UserId = "10000000-0000-0000-0000-000000000002",
                Nickname = "小红",
                TokenHash = TokenAuth.Hash("demo-bob")
            });
        await db.SaveChangesAsync();
    }
}
