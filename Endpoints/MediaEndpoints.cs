using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Common;
using MiniSpace.Models;
using MiniSpace.Repositories;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace MiniSpace.Endpoints;

public record MediaDto(string Sha256, string ContentType, int Width, int Height, string Url);

public static class MediaRoutes
{
    extension(IEndpointRouteBuilder builder)
    {
        public IEndpointRouteBuilder MapMediaEndpoints()
        {
            builder.MapGet("/media/{key}", MediaEndpoints.GetMediaAsync).RequireAuthorization();
            builder.MapPost("/api/media/", MediaEndpoints.UploadImageAsync).RequireAuthorization().DisableAntiforgery();

            return builder;
        }
    }

}

public class MediaEndpoints
{
    internal static async Task<Results<FileContentHttpResult, PhysicalFileHttpResult, NotFound, ProblemHttpResult>>
        GetMediaAsync(string key, AppDbContext db, ThumbDbContext thumbs, MediaStore mediaStore, HttpContext ctx)
    {
        var (sha256, mode) = SplitKey(key);
        if (mode is not null && !ThumbModes.Contains(mode))
        {
            return TypedResults.Problem(
                title: "Invalid thumb mode",
                detail: "未知的缩略图模式",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var media = await db.Media.FirstOrDefaultAsync(m => m.Sha256 == sha256);
        if (media is null)
        {
            return TypedResults.NotFound();
        }

        var path = mediaStore.PathFor(sha256);
        if (!File.Exists(path))
        {
            return TypedResults.NotFound();
        }

        // sha256 内容寻址，URL 永不失效；private 避免带鉴权响应进共享缓存
        ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";

        // 缺尺寸时先解码一次写回（原图与缩略图路径共用）
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
            {
                return TypedResults.PhysicalFile(path, media.Mime);
            }

            return TypedResults.File(thumbBytes, "image/webp");
        }

        return TypedResults.PhysicalFile(path, media.Mime);
    }
    internal static async Task<Results<Created<MediaDto>, ProblemHttpResult>>
        UploadImageAsync(IFormFile file, AppDbContext db, HttpContext ctx, MediaStore mediaStore, ILogger<MediaEndpoints> logger)
    {
        var userId = ctx.User.UserId;

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedExt.Contains(ext))
        {
            return TypedResults.Problem(
                title: "Invalid image",
                detail: "仅支持 jpg/jpeg/png/gif/webp/bmp 图片",
                statusCode: StatusCodes.Status400BadRequest
            );
        }

        if (file.Length <= 0 || file.Length > MaxSize)
        {
            return TypedResults.Problem(
                title: "Invalid image",
                detail: "图片大小需在 20MB 以内",
                statusCode: StatusCodes.Status400BadRequest
            );
        }

        byte[] bytes;
        await using (var ms = new MemoryStream())
        {
            await file.CopyToAsync(ms);
            bytes = ms.ToArray();
        }

        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var (w, h) = ParseDimensions(bytes);
        if (w <= 0 || h <= 0)
        {
            return TypedResults.Problem(
                title: "Invalid image",
                detail: "无法解析图片内容，文件可能不是有效图片",
                statusCode: StatusCodes.Status400BadRequest
            );
        }

        var gate = UploadLocks.GetOrAdd(sha256, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        Media? existing = null;
        try
        {
            existing = await db.Media.FirstOrDefaultAsync(m => m.Sha256 == sha256);
            if (existing is null)
            {
                var path = mediaStore.PathFor(sha256);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllBytesAsync(path, bytes);

                var mime = DetectImageMime(bytes);
                if (string.IsNullOrEmpty(mime))
                {
                    mime = string.IsNullOrWhiteSpace(file.ContentType)
                        ? "application/octet-stream"
                        : file.ContentType;
                }

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
                logger.LogInformation(
                    "media.upload sha256={sha256} size={bytes.Length} user_id={userId} ip={ip}",
                    sha256, bytes.Length, userId, ctx.Connection.RemoteIpAddress);
            }
            else
            {
                logger.LogInformation(
                    "media.reuse sha256={sha256} user_id={userId} ip={ip}",
                    sha256, userId, ctx.Connection.RemoteIpAddress);
                if (existing.Width <= 0 || existing.Height <= 0)
                {
                    existing.Width = w;
                    existing.Height = h;
                    await db.SaveChangesAsync();
                }
                var path = mediaStore.PathFor(sha256);
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

        return TypedResults.Created($"/media/{sha256}",
            new MediaDto(sha256, existing.Mime, existing.Width, existing.Height, $"/media/{sha256}"));
    }

    #region Non-Public
    private static readonly HashSet<string> AllowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    private static readonly byte[] ThumbFail = Encoding.ASCII.GetBytes("THUMBFAIL");
    private static readonly long MaxSize = 20L * 1024 * 1024;
    private static readonly int ThumbSmallWidth = 384;
    private static readonly int ThumbMediumWidth = 1024;
    private static readonly string ThumbModeSmall = "small";
    private static readonly string ThumbModeMedium = "medium";
    private static readonly HashSet<string> ThumbModes = [ThumbModeSmall, ThumbModeMedium];
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ThumbLocks = new();
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> UploadLocks = new();
    private static readonly SemaphoreSlim ThumbWriteGate = new(1, 1);
    private static (string Sha256, string? Mode) SplitKey(string key)
    {
        var at = key.IndexOf('@');
        if (at < 0)
        {
            return (key, null);
        }

        return (key[..at], key[(at + 1)..]);
    }
    private static async Task<(byte[] Bytes, bool Failed)> GetOrCreateThumbAsync(
        ThumbDbContext db, string originalPath, string sha256, int baseWidth, int origW, int origH)
    {
        if (origW <= 0 || origH <= 0)
        {
            return ([], true);
        }

        var scale = Math.Min(1.0, (double)baseWidth / origW);
        var w = Math.Max(1, (int)Math.Round(origW * scale));
        var h = Math.Max(1, (int)Math.Round(origH * scale));

        var hit = await db.Thumbs.AsNoTracking()
            .FirstOrDefaultAsync(t => t.RawSha256 == sha256 && t.Width == w && t.Height == h);
        if (hit is not null)
        {
            return IsThumbFail(hit.Blob) ? ([], true) : (hit.Blob, false);
        }

        var gate = ThumbLocks.GetOrAdd(sha256, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync();
        try
        {
            hit = await db.Thumbs.AsNoTracking()
                .FirstOrDefaultAsync(t => t.RawSha256 == sha256 && t.Width == w && t.Height == h);
            if (hit is not null)
            {
                return IsThumbFail(hit.Blob) ? ([], true) : (hit.Blob, false);
            }

            await ThumbWriteGate.WaitAsync();
            byte[] blob;
            bool failed;
            try
            {
                var original = await File.ReadAllBytesAsync(originalPath);
                using var image = Image.Load(original);
                while (image.Frames.Count > 1)
                {
                    image.Frames.RemoveFrame(1); // GIF/动画取第一帧
                }

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
    private static bool IsThumbFail(byte[] blob)
    {
        return blob.Length < 16 && blob.AsSpan().StartsWith(ThumbFail);
    }
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
        {
            return "image/jpeg";
        }

        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
        {
            return "image/png";
        }

        if (b.Length >= 6 && b[0] == (byte)'G' && b[1] == (byte)'I' && b[2] == (byte)'F' &&
            b[3] == (byte)'8')
        {
            return "image/gif";
        }

        if (b.Length >= 12 && b[0] == (byte)'R' && b[1] == (byte)'I' && b[2] == (byte)'F' &&
            b[3] == (byte)'F' && b[8] == (byte)'W' && b[9] == (byte)'E' &&
            b[10] == (byte)'B' && b[11] == (byte)'P')
        {
            return "image/webp";
        }

        if (b.Length >= 2 && b[0] == (byte)'B' && b[1] == (byte)'M')
        {
            return "image/bmp";
        }

        return "";
    }
    #endregion

}
