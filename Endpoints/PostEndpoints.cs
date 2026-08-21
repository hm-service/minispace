using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Data;
using MiniSpace.Models;

namespace MiniSpace.Endpoints;

public static class PostEndpoints
{
    private const int PageSize = 10;
    private static readonly Regex Sha256Regex = new("^[0-9a-fA-F]{64}$");

    public static IEndpointRouteBuilder MapPostEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/posts");

        group.MapPost("/", Create);
        group.MapGet("/metadata", Metadata);
        group.MapGet("/", List);
        group.MapGet("/{postId}", GetOne);
        group.MapPost("/{postId}/comments", AddComment);
        group.MapGet("/{postId}/comments", ListComments);
        group.MapDelete("/{postId}", Delete);

        return app;
    }

    private static async Task<IResult> Create(
        CreatePostRequest req, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var text = req.TextContent?.Trim() ?? "";
        var media = req.MediaContent ?? [];
        if (text.Length == 0 && media.Count == 0)
            return ApiErrors.BadRequest("textContent 与 mediaContent 不能都为空");
        if (text.Length > 10000)
            return ApiErrors.BadRequest("textContent 最多 10000 字");
        if (media.Any(m => !Sha256Regex.IsMatch(m)))
            return ApiErrors.BadRequest("mediaContent 包含非法 SHA256");

        var distinct = media.Distinct().ToList();
        var uploaded = await db.Media.AsNoTracking()
            .Where(m => distinct.Contains(m.Sha256))
            .Select(m => m.Sha256)
            .ToListAsync();
        if (distinct.Any(s => !uploaded.Contains(s)))
            return ApiErrors.BadRequest("mediaContent 包含未上传的图片");

        var post = new Post
        {
            PostId = Guid.NewGuid().ToString("D"),
            UserId = user.UserId,
            TextContent = text,
            MediaContent = JsonSerializer.Serialize(media),
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            IsDeleted = false
        };
        db.Posts.Add(post);
        await db.SaveChangesAsync();
        AuditLog.Write($"post.create post_id={post.PostId} user_id={user.UserId} " +
                       $"ip={ctx.Connection.RemoteIpAddress}");

        var dto = await LoadPostAsync(db, post.PostId);
        return Results.Created($"/api/posts/{post.PostId}", dto);
    }

    private static async Task<IResult> Metadata(AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var count = await db.Posts.CountAsync(p => !p.IsDeleted);
        return Results.Ok(new PostMetadata(count));
    }

    private static async Task<IResult> List(int? page, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var rawPage = page ?? 1;
        var current = rawPage <= 0 ? 1 : rawPage;
        var total = await db.Posts.CountAsync(p => !p.IsDeleted);
        var pageCount = Math.Max(1, (int)Math.Ceiling(total / (double)PageSize));
        if (current > pageCount)
            current = pageCount;

        var rows = await (
            from p in db.Posts.AsNoTracking()
            join u in db.Users.AsNoTracking() on p.UserId equals u.UserId
            where !p.IsDeleted
            orderby p.CreatedAt descending, p.Id descending
            select new { p.PostId, p.UserId, u.Nickname, p.TextContent, p.MediaContent, p.CreatedAt })
            .Skip((current - 1) * PageSize)
            .Take(PageSize)
            .ToListAsync();

        var items = rows
            .Select(r => new PostDto(r.PostId, r.UserId, r.Nickname, r.TextContent,
                ParseMedia(r.MediaContent), r.CreatedAt))
            .ToList();
        return Results.Ok(new PostList(items));
    }

    private static async Task<IResult> GetOne(string postId, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var dto = await LoadPostAsync(db, postId);
        return dto is null ? ApiErrors.NotFound("帖子不存在") : Results.Ok(dto);
    }

    private static async Task<IResult> AddComment(
        string postId, CreateCommentRequest req, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var content = req.Content?.Trim() ?? "";
        if (content.Length == 0)
            return ApiErrors.BadRequest("评论不能为空");
        if (content.Length > 500)
            return ApiErrors.BadRequest("评论最多 500 字");
        if (!await db.Posts.AnyAsync(p => p.PostId == postId && !p.IsDeleted))
            return ApiErrors.NotFound("帖子不存在");

        var comment = new Comment
        {
            CommentId = Guid.NewGuid().ToString("D"),
            PostId = postId,
            UserId = user.UserId,
            Content = content,
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            IsDeleted = false
        };
        db.Comments.Add(comment);
        await db.SaveChangesAsync();
        AuditLog.Write($"comment.create comment_id={comment.CommentId} post_id={postId} " +
                       $"user_id={user.UserId} ip={ctx.Connection.RemoteIpAddress}");

        return Results.Created($"/api/comments/{comment.CommentId}",
            new CommentDto(comment.CommentId, user.UserId, postId, user.Nickname, content, comment.CreatedAt));
    }

    private static async Task<IResult> ListComments(string postId, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");
        if (!await db.Posts.AnyAsync(p => p.PostId == postId && !p.IsDeleted))
            return ApiErrors.NotFound("帖子不存在");

        var items = await (
            from c in db.Comments.AsNoTracking()
            join u in db.Users.AsNoTracking() on c.UserId equals u.UserId
            where c.PostId == postId && !c.IsDeleted
            orderby c.CreatedAt descending, c.Id descending
            select new CommentDto(c.CommentId, c.UserId, c.PostId, u.Nickname, c.Content, c.CreatedAt))
            .ToListAsync();
        return Results.Ok(new CommentList(items));
    }

    private static async Task<IResult> Delete(string postId, AppDbContext db, HttpContext ctx)
    {
        var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
        if (user is null)
            return ApiErrors.Unauthorized("未登录或 token 无效");

        var post = await db.Posts.FirstOrDefaultAsync(p => p.PostId == postId && !p.IsDeleted);
        if (post is null)
            return ApiErrors.NotFound("帖子不存在");
        if (post.UserId != user.UserId)
        {
            AuditLog.Write($"post.delete.denied post_id={postId} user_id={user.UserId} " +
                           $"ip={ctx.Connection.RemoteIpAddress}");
            return ApiErrors.Forbidden("只能删除自己的帖子");
        }

        post.IsDeleted = true;
        await db.SaveChangesAsync();
        AuditLog.Write($"post.delete post_id={postId} user_id={user.UserId} " +
                       $"ip={ctx.Connection.RemoteIpAddress}");
        return Results.NoContent();
    }

    private static async Task<PostDto?> LoadPostAsync(AppDbContext db, string postId)
    {
        var row = await (
            from p in db.Posts.AsNoTracking()
            join u in db.Users.AsNoTracking() on p.UserId equals u.UserId
            where p.PostId == postId && !p.IsDeleted
            select new { p.PostId, p.UserId, u.Nickname, p.TextContent, p.MediaContent, p.CreatedAt })
            .FirstOrDefaultAsync();
        return row is null
            ? null
            : new PostDto(row.PostId, row.UserId, row.Nickname, row.TextContent,
                ParseMedia(row.MediaContent), row.CreatedAt);
    }

    private static List<string> ParseMedia(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch
        {
            return [];
        }
    }
}
