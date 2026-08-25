using System.Collections.Immutable;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Common;
using MiniSpace.Models;
using MiniSpace.Repositories;

namespace MiniSpace.Endpoints;

public record MediaItem(
    string Sha256,
    int Width,
    int Height);

public record PostDto(
    string PostId,
    string UserId,
    string Nickname,
    string TextContent,
    List<MediaItem> MediaContent,
    long CreatedAt);

public record PostListDto(List<PostDto> Items);

public record PostMetadataDto(int TotalCount);

public record CreatePostRequest(string? TextContent, List<string>? MediaContent);

public static partial class PostRoutes
{
    extension(IEndpointRouteBuilder builder)
    {
        public IEndpointRouteBuilder MapPostEndpoints()
        {
            builder.MapGet("/api/posts/metadata", PostEndpoints.GetMetadataAsync).RequireAuthorization();
            builder.MapGet("/api/posts/", PostEndpoints.GetPostListAsync).RequireAuthorization();
            builder.MapGet("/api/posts/{postId}", PostEndpoints.GetPostAsync).RequireAuthorization();
            builder.MapPost("/api/posts", PostEndpoints.CreatePostAsync).RequireAuthorization();
            builder.MapDelete("/api/posts/{postId}", PostEndpoints.DeletePostAsync).RequireAuthorization();

            return builder;
        }
    }
}

public partial class PostEndpoints
{
    internal static async Task<Results<Created<PostDto>, ProblemHttpResult>>
        CreatePostAsync(CreatePostRequest req, AppDbContext db, HttpContext ctx, ILogger<PostEndpoints> logger)
    {
        var userId = ctx.User.UserId;
        var text = req.TextContent?.Trim() ?? "";
        var mediaSha256List = req.MediaContent ?? [];
        if (text.Length == 0 && mediaSha256List.Count == 0)
        {
            return ProblemResults.InvalidContent("textContent 与 mediaContent 不能都为空");
        }

        if (text.Length > 10000)
        {
            return ProblemResults.InvalidContent("textContent 最多 10000 字");
        }

        if (mediaSha256List.Any(m => !Sha256Regex().IsMatch(m)))
        {
            return ProblemResults.InvalidContent("mediaContent 包含非法 SHA256");
        }

        var distinct = mediaSha256List.Distinct().ToList();
        var uploaded = await db.Media
            .AsNoTracking()
            .Where(m => distinct.Contains(m.Sha256))
            .Select(m => m.Sha256)
            .ToListAsync();
        if (distinct.Any(s => !uploaded.Contains(s)))
        {
            return ProblemResults.InvalidContent("mediaContent 包含未上传的图片");
        }

        var post = new Post
        {
            PostId = Guid.NewGuid().ToString("D"),
            UserId = userId,
            TextContent = text,
            MediaContent = JsonSerializer.Serialize(mediaSha256List, s_mediaJsonOptions),
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            IsDeleted = false
        };
        db.Posts.Add(post);
        await db.SaveChangesAsync();
        logger.LogInformation(
            "post.create post_id={postId} user_id={userId} ip={ip}",
            post.PostId, userId, ctx.Connection.RemoteIpAddress);

        var dto = await LoadPostAsync(post.PostId, db);
        return TypedResults.Created($"/api/posts/{post.PostId}", dto);
    }
    internal static async Task<Ok<PostMetadataDto>>
        GetMetadataAsync(AppDbContext db)
    {
        var count = await db.Posts.CountAsync(p => !p.IsDeleted);
        return TypedResults.Ok(new PostMetadataDto(count));
    }
    internal static async Task<Ok<PostListDto>>
        GetPostListAsync(int? page, AppDbContext db)
    {
        var rawPage = page ?? 1;
        var current = rawPage <= 0 ? 1 : rawPage;
        var total = await db.Posts.CountAsync(p => !p.IsDeleted);
        var pageCount = Math.Max(1, (int)Math.Ceiling(total / (double)s_pageSize));
        if (current > pageCount)
        {
            current = pageCount;
        }

        var rows = await (
            from p in db.Posts.AsNoTracking()
            join u in db.Users.AsNoTracking() on p.UserId equals u.UserId
            where !p.IsDeleted
            orderby p.CreatedAt descending, p.Id descending
            select new { p.PostId, p.UserId, u.Nickname, p.TextContent, p.MediaContent, p.CreatedAt })
            .Skip((current - 1) * s_pageSize)
            .Take(s_pageSize)
            .ToListAsync();
        var dtos = new List<PostDto>();
        foreach (var row in rows)
        {
            var dto = new PostDto(
                PostId: row.PostId,
                UserId: row.UserId,
                Nickname: row.Nickname,
                TextContent: row.TextContent,
                MediaContent: await ParseToMediaItemListAsync(row.MediaContent, db),
                CreatedAt: row.CreatedAt
            );
            dtos.Add(dto);
        }

        return TypedResults.Ok(new PostListDto(dtos));
    }
    internal static async Task<Results<Ok<PostDto>, NotFound>>
        GetPostAsync(string postId, AppDbContext db)
    {
        var dto = await LoadPostAsync(postId, db);
        if (dto is null)
        {
            return TypedResults.NotFound();
        }

        return TypedResults.Ok(dto);
    }
    internal static async Task<Results<NoContent, NotFound, ProblemHttpResult>>
        DeletePostAsync(string postId, AppDbContext db, HttpContext ctx, ILogger<PostEndpoints> logger)
    {
        var userId = ctx.User.UserId;

        var post = await db.Posts.FirstOrDefaultAsync(p => p.PostId == postId && !p.IsDeleted);
        if (post is null)
        {
            return TypedResults.NotFound();
        }

        if (post.UserId != userId)
        {
            logger.LogInformation(
                "post.delete.denied post_id={postId} user_id={userId} ip={ip}",
                postId, userId, ctx.Connection.RemoteIpAddress);
            return ProblemResults.InvalidOperation("只能删除自己的帖子");
        }

        post.IsDeleted = true;
        await db.SaveChangesAsync();
        logger.LogInformation(
            "post.delete post_id={postId} user_id={userId} ip={ip}",
            postId, userId, ctx.Connection.RemoteIpAddress);
        return TypedResults.NoContent();
    }

    #region Non-Public
    private static readonly int s_pageSize = 10;
    private static readonly JsonSerializerOptions s_mediaJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static async Task<PostDto?> LoadPostAsync(string postId, AppDbContext db)
    {
        var row = await (
            from p in db.Posts.AsNoTracking()
            join u in db.Users.AsNoTracking() on p.UserId equals u.UserId
            where p.PostId == postId && !p.IsDeleted
            select new { p.PostId, p.UserId, u.Nickname, p.TextContent, p.MediaContent, p.CreatedAt })
            .FirstOrDefaultAsync();

        if (row is null)
        {
            return null;
        }

        return new PostDto(
            PostId: row.PostId,
            UserId: row.UserId,
            Nickname: row.Nickname,
            TextContent: row.TextContent,
            MediaContent: await ParseToMediaItemListAsync(row.MediaContent, db),
            CreatedAt: row.CreatedAt);
    }
    private static async Task<List<MediaItem>> ParseToMediaItemListAsync(string json, AppDbContext db)
    {
        var mediaSha256List = JsonSerializer.Deserialize<string[]>(json) ?? [];
        if (mediaSha256List.Length == 0)
        {
            return [];
        }

        return await GetMediaItemsAsync(mediaSha256List, db);
    }
    private static async Task<List<MediaItem>> GetMediaItemsAsync(IReadOnlyCollection<string> mediaSha256List, AppDbContext db)
    {
        var mediaSha256Set = mediaSha256List.ToImmutableHashSet();

        var rows = await db.Media
            .AsNoTracking()
            .Where(m => mediaSha256Set.Contains(m.Sha256))
            .Select(m => new MediaItem(
                Sha256: m.Sha256,
                Width: Math.Max(m.Width, 0),
                Height: Math.Max(m.Height, 0)))
            .ToListAsync();

        return rows;
    }
    [GeneratedRegex("^[0-9a-fA-F]{64}$")]
    private static partial Regex Sha256Regex();
    #endregion
}
