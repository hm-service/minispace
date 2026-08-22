using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Data;
using MiniSpace.Models;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace MiniSpace.Endpoints;

public static class MediaEndpoints
{
    private static readonly string[] AllowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    private const long MaxSize = 20L * 1024 * 1024;

    private const int ThumbSmallWidth = 384;
    private const int ThumbMediumWidth = 1024;
    private const string ThumbModeSmall = "small";
    private const string ThumbModeMedium = "medium";
    private static readonly HashSet<string> ThumbModes = [ThumbModeSmall, ThumbModeMedium];
    private static readonly byte[] ThumbFail = Encoding.ASCII.GetBytes("THUMBFAIL");
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ThumbLocks = new();
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> UploadLocks = new();
    private static readonly SemaphoreSlim ThumbWriteGate = new(1, 1);

    public static IEndpointRouteBuilder MapMediaEndpoints(this IEndpointRouteBuilder app, string mediaDir)
    {
        app.MapGet("/media/{key}", async (
            string key, AppDbContext db, ThumbDbContext thumbs, HttpContext ctx) =>
        {
            var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
            if (user is null)
                return ApiErrors.Unauthorized("未登录或 token 无效");

            var (sha256, mode) = SplitKey(key);
            if (mode is not null && !ThumbModes.Contains(mode))
                return ApiErrors.BadRequest("未知的缩略图模式");

            var media = await db.Media.FirstOrDefaultAsync(m => m.Sha256 == sha256);
            if (media is null)
                return ApiErrors.NotFound("媒体不存在");

            var path = MediaStore.PathFor(mediaDir, sha256);
            if (!File.Exists(path))
                return ApiErrors.NotFound("媒体不存在");

            // sha256 内容寻址，URL 永不失效；private 避免带鉴权响应进共享缓存
            ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";

            // 懒修复：旧数据缺尺寸时先解码一次写回（原图与缩略图路径共用）
            if (media.Width <= 0 || media.Height <= 0)
            {
                var (w, h) = ParseDimensions(await File.ReadAllBytesAsync(path));
                if (w > 0 && h > 0)
                {
                    media.Width = w;
                    media.Height = h;
                    await db.SaveChangesAsync();
                }
            }

            if (mode == ThumbModeSmall || mode == ThumbModeMedium)
            {
                var baseWidth = mode == ThumbModeMedium ? ThumbMediumWidth : ThumbSmallWidth;
                var (thumbBytes, failed) = await GetOrCreateThumbAsync(
                    thumbs, path, sha256, baseWidth, media.Width, media.Height);
                if (failed)
                    return Results.File(path, media.Mime);
                return Results.File(thumbBytes, "image/webp");
            }

            return Results.File(path, media.Mime);
        });

        var group = app.MapGroup("/api/media");
        group.MapPost("/", async (
            IFormFile file, AppDbContext db, HttpContext ctx) =>
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
            var (w, h) = ParseDimensions(bytes);
            if (w <= 0 || h <= 0)
                return ApiErrors.BadRequest("无法解析图片内容，文件不是有效图片");

            var gate = UploadLocks.GetOrAdd(sha256, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync();
            Media? existing = null;
            try
            {
                existing = await db.Media.FirstOrDefaultAsync(m => m.Sha256 == sha256);
                if (existing is null)
                {
                    var path = MediaStore.PathFor(mediaDir, sha256);
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    await File.WriteAllBytesAsync(path, bytes);

                    var mime = DetectImageMime(bytes);
                    if (string.IsNullOrEmpty(mime))
                        mime = string.IsNullOrWhiteSpace(file.ContentType)
                            ? "application/octet-stream"
                            : file.ContentType;

                    existing = new Media
                    {
                        Sha256 = sha256,
                        Mime = mime,
                        Size = bytes.Length,
                        Width = w,
                        Height = h
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
                    if (existing.Width <= 0 || existing.Height <= 0)
                    {
                        existing.Width = w;
                        existing.Height = h;
                        await db.SaveChangesAsync();
                    }
                    var path = MediaStore.PathFor(mediaDir, sha256);
                    if (!File.Exists(path))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                        await File.WriteAllBytesAsync(path, bytes);
                    }
                }
            }
            finally
            {
                gate.Release();
                UploadLocks.TryRemove(new KeyValuePair<string, SemaphoreSlim>(sha256, gate));
            }

            return Results.Created($"/media/{sha256}",
                new MediaDto(sha256, existing.Mime, existing.Width, existing.Height, $"/media/{sha256}"));
        }).DisableAntiforgery();

        return app;
    }

    private static (string Sha256, string? Mode) SplitKey(string key)
    {
        var at = key.IndexOf('@');
        if (at < 0)
            return (key, null);
        return (key[..at], key[(at + 1)..]);
    }

    private static async Task<(byte[] Bytes, bool Failed)> GetOrCreateThumbAsync(
        ThumbDbContext db, string originalPath, string sha256, int baseWidth, int origW, int origH)
    {
        // 尺寸直接来自 media 表（上传时解析 / 旧数据懒修复），不再解码原图探测
        if (origW <= 0 || origH <= 0)
            return ([], true);

        var scale = Math.Min(1.0, (double)baseWidth / origW);
        var w = Math.Max(1, (int)Math.Round(origW * scale));
        var h = Math.Max(1, (int)Math.Round(origH * scale));

        var hit = await db.Thumbs.AsNoTracking()
            .FirstOrDefaultAsync(t => t.RawSha256 == sha256 && t.Width == w && t.Height == h);
        if (hit is not null)
            return IsThumbFail(hit.Blob) ? ([], true) : (hit.Blob, false);

        var gate = ThumbLocks.GetOrAdd(sha256, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            hit = await db.Thumbs.AsNoTracking()
                .FirstOrDefaultAsync(t => t.RawSha256 == sha256 && t.Width == w && t.Height == h);
            if (hit is not null)
                return IsThumbFail(hit.Blob) ? ([], true) : (hit.Blob, false);

            await ThumbWriteGate.WaitAsync();
            byte[] blob;
            bool failed;
            try
            {
                var original = await File.ReadAllBytesAsync(originalPath);
                using var image = Image.Load(original);
                while (image.Frames.Count > 1)
                    image.Frames.RemoveFrame(1); // GIF/动画取第一帧
                image.Mutate(x => x.Resize(new ResizeOptions
                {
                    Size = new Size(w, h),
                    Mode = ResizeMode.Stretch
                }));
                using var ms = new MemoryStream();
                await image.SaveAsync(ms, new WebpEncoder { Quality = 80 });
                blob = ms.ToArray();
                failed = false;

                db.Thumbs.Add(new Thumb { RawSha256 = sha256, Width = w, Height = h, Blob = blob });
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    // 唯一索引冲突：并发下另一个请求已写入，忽略
                }
            }
            catch
            {
                blob = ThumbFail;
                failed = true;
            }
            finally
            {
                ThumbWriteGate.Release();
            }

            return failed ? ([], true) : (blob, false);
        }
        finally
        {
            gate.Release();
            ThumbLocks.TryRemove(new KeyValuePair<string, SemaphoreSlim>(sha256, gate));
        }
    }

    private static bool IsThumbFail(byte[] blob) =>
        blob.Length < 16 && blob.AsSpan().StartsWith(ThumbFail);

    private static (int Width, int Height) ParseDimensions(byte[] bytes)
    {
        try
        {
            using var img = Image.Load(bytes);
            return (img.Width, img.Height);
        }
        catch
        {
            return (0, 0);
        }
    }

    private static string DetectImageMime(byte[] b)
    {
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return "image/jpeg";
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return "image/png";
        if (b.Length >= 6 && b[0] == (byte)'G' && b[1] == (byte)'I' && b[2] == (byte)'F' &&
            b[3] == (byte)'8')
            return "image/gif";
        if (b.Length >= 12 && b[0] == (byte)'R' && b[1] == (byte)'I' && b[2] == (byte)'F' &&
            b[3] == (byte)'F' && b[8] == (byte)'W' && b[9] == (byte)'E' &&
            b[10] == (byte)'B' && b[11] == (byte)'P')
            return "image/webp";
        if (b.Length >= 2 && b[0] == (byte)'B' && b[1] == (byte)'M')
            return "image/bmp";
        return "";
    }
}
