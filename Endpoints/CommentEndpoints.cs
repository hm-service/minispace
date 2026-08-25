using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Repositories;
using MiniSpace.Models;

namespace MiniSpace.Endpoints;

public record CommentDto(
    string CommentId,
    string UserId,
    string PostId,
    string Nickname,
    string Content,
    long CreatedAt);

public record CommentList(List<CommentDto> Items);

public record CreateCommentRequest(string? PostId, string? Content);

public static class CommentEndpoints
{
    extension(IEndpointRouteBuilder builder)
    {
        public IEndpointRouteBuilder MapCommentEndpoints()
        {
            builder.MapPost("/api/comments", CreateCommentAsync).RequireAuthorization();
            builder.MapGet("/api/comments", GetCommentListAsync).RequireAuthorization();
            builder.MapDelete("/api/comments/{commentId}", DeleteCommentAsync).RequireAuthorization();

            return builder;
        }
    }

    #region Non-Public
    private static async Task<Results<Created<CommentDto>, ProblemHttpResult, NotFound>>
        CreateCommentAsync(CreateCommentRequest req, AppDbContext db, HttpContext ctx)
    {
        var userId = ctx.User.UserId;
        var userNickname = ctx.User.Nickname;

        var content = req.Content?.Trim() ?? string.Empty;
        if (content.Length == 0)
        {
            return ProblemResults.InvalidContent("评论不能为空");
        }
        if (content.Length > 500)
        {
            return ProblemResults.InvalidContent("评论最多 500 字");
        }

        var postId = req.PostId?.Trim() ?? string.Empty;
        if (postId.Length == 0)
        {
            return ProblemResults.InvalidContent("postId 不能为空");
        }

        if (!await db.Posts.AnyAsync(p => p.PostId == postId && !p.IsDeleted))
        {
            return TypedResults.NotFound();
        }

        var comment = new Comment
        {
            CommentId = Guid.NewGuid().ToString("D"),
            PostId = postId,
            UserId = userId,
            Content = content,
            CreatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            IsDeleted = false
        };
        db.Comments.Add(comment);
        await db.SaveChangesAsync();
        AuditLog.Write($"comment.create comment_id={comment.CommentId} post_id={postId} " +
                       $"user_id={userId} ip={ctx.Connection.RemoteIpAddress}");

        return TypedResults.Created($"/api/comments/{comment.CommentId}",
            new CommentDto(comment.CommentId, userId, postId, userNickname, content, comment.CreatedAt));
    }
    private static async Task<Results<Ok<CommentList>, NotFound, ProblemHttpResult>>
        GetCommentListAsync(string? postId, AppDbContext db, HttpContext ctx)
    {
        postId = postId?.Trim() ?? string.Empty;
        if (postId.Length == 0)
        {
            return ProblemResults.InvalidContent("postId 不能为空");
        }

        if (!await db.Posts.AnyAsync(p => p.PostId == postId && !p.IsDeleted))
        {
            return TypedResults.NotFound();
        }

        var items = await (
            from c in db.Comments.AsNoTracking()
            join u in db.Users.AsNoTracking() on c.UserId equals u.UserId
            where c.PostId == postId && !c.IsDeleted
            orderby c.CreatedAt descending, c.Id descending
            select new CommentDto(c.CommentId, c.UserId, c.PostId, u.Nickname, c.Content, c.CreatedAt))
            .ToListAsync();
        return TypedResults.Ok(new CommentList(items));
    }
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>>
        DeleteCommentAsync(string commentId, AppDbContext db, HttpContext ctx)
    {
        var userId = ctx.User.UserId;
        var comment = await db.Comments
            .FirstOrDefaultAsync(c => c.CommentId == commentId && !c.IsDeleted);

        if (comment is null)
            return TypedResults.NotFound();
        if (comment.UserId != userId)
        {
            AuditLog.Write($"comment.delete.denied comment_id={commentId} " +
                           $"user_id={userId} ip={ctx.Connection.RemoteIpAddress}");
            return ProblemResults.ForbiddenOperation("只能删除自己的评论");
        }

        comment.IsDeleted = true;
        await db.SaveChangesAsync();
        AuditLog.Write($"comment.delete comment_id={commentId} post_id={comment.PostId} " +
                       $"user_id={userId} ip={ctx.Connection.RemoteIpAddress}");

        return TypedResults.NoContent();
    }
    #endregion
}
