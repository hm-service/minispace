namespace MiniSpace.Models;

public record ErrorBody(int Code, string Message);

public record LoginResult(string UserId, string Nickname);

public record CreatePostRequest(string? TextContent, List<string>? MediaContent);

public record CreateCommentRequest(string? Content);

public record PostDto(
    string PostId,
    string UserId,
    string Nickname,
    string TextContent,
    List<MediaItem> MediaContent,
    long CreatedAt);

public record PostList(List<PostDto> Items);

public record PostMetadata(int TotalCount);

public record CommentDto(
    string CommentId,
    string UserId,
    string PostId,
    string Nickname,
    string Content,
    long CreatedAt);

public record CommentList(List<CommentDto> Items);

public record MediaDto(string Sha256, string ContentType, int Width, int Height, string Url);

public record MediaItem(string Sha256, int Width, int Height);
