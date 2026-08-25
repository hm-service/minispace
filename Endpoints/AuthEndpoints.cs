using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.HttpResults;
using MiniSpace.Common;

namespace MiniSpace.Endpoints;

public record LoginResult(string UserId, string Nickname);

public static class AuthRoutes
{
    extension(IEndpointRouteBuilder builder)
    {
        public IEndpointRouteBuilder MapAuthEndpoints()
        {
            builder.MapPost("/api/login", AuthEndpoints.LoginAsync).AllowAnonymous();

            return builder;
        }
    }
}


public class AuthEndpoints
{
    internal static async Task<Results<Ok<LoginResult>, UnauthorizedHttpResult, ProblemHttpResult>>
        LoginAsync(HttpContext ctx, ILogger<AuthEndpoints> logger)
    {
        var result = await ctx.AuthenticateAsync(TokenAuthDefaults.Scheme);

        if (!result.Succeeded)
        {
            logger.LogWarning("login.denied ip={ip}", ctx.Connection.RemoteIpAddress?.ToString());

            // NoResult = 没带 token（Failure 为 null）→ 400；Fail = token 无效 → 401
            return result.Failure is null
                ? ProblemResults.InvalidContent("token 不能为空")
                : TypedResults.Unauthorized();
        }

        var userId = result.Principal.UserId;
        var nickname = result.Principal.Nickname;
        logger.LogInformation("login.ok user_id={userId} nickname={nickname} ip={ip}",
            userId, nickname, ctx.Connection.RemoteIpAddress?.ToString());
        return TypedResults.Ok(new LoginResult(userId, nickname));
    }
}
