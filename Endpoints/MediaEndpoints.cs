using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Data;
using MiniSpace.Models;

namespace MiniSpace.Endpoints;

public static class MediaEndpoints
{
    private static readonly string[] AllowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    private const long MaxSize = 20L * 1024 * 1024;

    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder app, string mediaDir)
    {
        app.MapGet("/media/{sha256}", async (string sha256, AppDbContext db, HttpContext ctx) =>
        {
            var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
            if (user is null)
                return ApiErrors.Unauthorized("未登录或 token 无效");

            var media = await db.Media.AsNoTracking().FirstOrDefaultAsync(m => m.Sha256 == sha256);
            if (media is null)
                return ApiErrors.NotFound("媒体不存在");

            var path = MediaStore.PathFor(mediaDir, sha256);
            return File.Exists(path) ? Results.File(path, media.Mime) : ApiErrors.NotFound("媒体不存在");
        });

        var group = app.MapGroup("/api/media");
        group.MapPost("/", async (IFormFile file, AppDbContext db, HttpContext ctx) =>
        {
            var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
            if (user is null)
                return ApiErrors.Unauthorized("未登录或 token 无效");

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!AllowedExt.Contains(ext))
                return ApiErrors.BadRequest("仅支持 jpg/jpeg/png/gif/webp/bmp 图片");
            if (file.Length <= 0 || file.Length > MaxSize)
                return ApiErrors.BadRequest("图片大小需在 20MB 以内");

            byte[] bytes;
            await using (var ms = new MemoryStream())
            {
                await file.CopyToAsync(ms);
                bytes = ms.ToArray();
            }

            var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var existing = await db.Media.FirstOrDefaultAsync(m => m.Sha256 == sha256);
            if (existing is null)
            {
                var path = MediaStore.PathFor(mediaDir, sha256);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllBytesAsync(path, bytes);

                existing = new Media
                {
                    Sha256 = sha256,
                    Mime = string.IsNullOrWhiteSpace(file.ContentType)
                        ? "application/octet-stream"
                        : file.ContentType,
                    Size = bytes.Length
                };
                db.Media.Add(existing);
                await db.SaveChangesAsync();
                AuditLog.Write($"media.upload sha256={sha256} size={bytes.Length} " +
                               $"user_id={user.UserId} ip={ctx.Connection.RemoteIpAddress}");
            }
            else
            {
                AuditLog.Write($"media.reuse sha256={sha256} user_id={user.UserId} " +
                               $"ip={ctx.Connection.RemoteIpAddress}");
                var path = MediaStore.PathFor(mediaDir, sha256);
                if (!File.Exists(path))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    await File.WriteAllBytesAsync(path, bytes);
                }
            }

            return Results.Created($"/media/{sha256}",
                new MediaDto(sha256, existing.Mime, $"/media/{sha256}"));
        }).DisableAntiforgery();

        return app;
    }
}
