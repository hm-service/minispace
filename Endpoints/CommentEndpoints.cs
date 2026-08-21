using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Data;

namespace MiniSpace.Endpoints;

public static class CommentEndpoints
{
    public static IEndpointRouteBuilder MapCommentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/comments");

        group.MapDelete("/{commentId}", async (string commentId, AppDbContext db, HttpContext ctx) =>
        {
            var user = await TokenAuth.AuthenticateAsync(db, ctx.Request.Headers.Authorization);
            if (user is null)
                return ApiErrors.Unauthorized("未登录或 token 无效");

            var comment = await db.Comments
                .FirstOrDefaultAsync(c => c.CommentId == commentId && !c.IsDeleted);
            if (comment is null)
                return ApiErrors.NotFound("评论不存在");
            if (comment.UserId != user.UserId)
            {
                AuditLog.Write($"comment.delete.denied comment_id={commentId} " +
                               $"user_id={user.UserId} ip={ctx.Connection.RemoteIpAddress}");
                return ApiErrors.Forbidden("只能删除自己的评论");
            }

            comment.IsDeleted = true;
            await db.SaveChangesAsync();
            AuditLog.Write($"comment.delete comment_id={commentId} post_id={comment.PostId} " +
                           $"user_id={user.UserId} ip={ctx.Connection.RemoteIpAddress}");
            return Results.NoContent();
        });

        return app;
    }
}
