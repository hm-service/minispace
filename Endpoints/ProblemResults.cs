using Microsoft.AspNetCore.Http.HttpResults;

namespace MiniSpace.Endpoints;

public static class ProblemResults
{
    public static ProblemHttpResult InvalidOperation(string detail)
    {
        return TypedResults.Problem(
            title: "Invalid Operation",
            detail: detail,
            statusCode: StatusCodes.Status400BadRequest);
    }

    public static ProblemHttpResult InvalidContent(string detail)
    {
        return TypedResults.Problem(
            title: "Invalid Content",
            detail: detail,
            statusCode: StatusCodes.Status400BadRequest);
    }

    public static ProblemHttpResult ForbiddenOperation(string detail)
    {
        return TypedResults.Problem(
            title: "Forbidden Operation",
            detail: detail,
            statusCode: StatusCodes.Status403Forbidden);
    }
}