using Microsoft.EntityFrameworkCore;
using MiniSpace.Auth;
using MiniSpace.Data;
using MiniSpace.Models;

namespace MiniSpace.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api");

        group.MapPost("/login", async (HttpContext ctx, AppDbContext db) =>
        {
            var token = TokenAuth.GetToken(ctx.Request.Headers.Authorization);
            if (token is null)
                return ApiErrors.BadRequest("token 不能为空");

            var user = await db.Users.AsNoTracking()
                .FirstOrDefaultAsync(u => u.TokenHash == TokenAuth.Hash(token));
            var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "-";
            return user is null
                ? Log(ApiErrors.Unauthorized("token 无效"),
                    $"login.denied ip={ip}")
                : Log(Results.Ok(new LoginResult(user.UserId, user.Nickname)),
                    $"login.ok user_id={user.UserId} nickname={user.Nickname} ip={ip}");
        });

        return app;
    }

    private static IResult Log(IResult result, string message)
    {
        AuditLog.Write(message);
        return result;
    }
}
