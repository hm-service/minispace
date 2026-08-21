using MiniSpace.Models;

namespace MiniSpace.Endpoints;

public static class ApiErrors
{
    public static IResult BadRequest(string message) => Error(400, message);
    public static IResult Unauthorized(string message) => Error(401, message);
    public static IResult Forbidden(string message) => Error(403, message);
    public static IResult NotFound(string message) => Error(404, message);

    public static IResult Error(int code, string message) =>
        Results.Json(new ErrorBody(code, message), statusCode: code);
}
