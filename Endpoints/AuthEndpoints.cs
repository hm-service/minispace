using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.HttpResults;
using MiniSpace.Auth;
using MiniSpace.Repositories;

namespace MiniSpace.Endpoints;

public record LoginResult(string UserId, string Nickname);

public static class AuthEndpoints
{
    extension(IEndpointRouteBuilder builder)
    {
        public IEndpointRouteBuilder MapAuthEndpoints()
        {
            builder.MapPost("/api/login", LoginAsync).AllowAnonymous();

            return builder;
        }
    }

    #region Non-Public
    private static async Task<Results<Ok<LoginResult>, UnauthorizedHttpResult, ProblemHttpResult>>
        LoginAsync(HttpContext ctx, AppDbContext db)
    {
        var result = await ctx.AuthenticateAsync(TokenAuthDefaults.Scheme);

        if (!result.Succeeded)
        {
            // NoResult = 没带 token（Failure 为 null）→ 400；Fail = token 无效 → 401
            return result.Failure is null
                ? ProblemResults.InvalidContent("token 不能为空")
                : TypedResults.Unauthorized();
        }

        var userId = result.Principal.UserId;
        var nickname = result.Principal.Nickname;
        var ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "-";
        AuditLog.Write($"login.ok user_id={userId} nickname={nickname} ip={ip}");
        return TypedResults.Ok(new LoginResult(userId, nickname));
    }
    #endregion
}
