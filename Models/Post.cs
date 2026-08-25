namespace MiniSpace.Models;

public class Post
{
    public int Id { get; set; }

    public required string PostId { get; set; }

    public required string UserId { get; set; }

    public required string TextContent { get; set; }

    public required string MediaContent { get; set; }

    public required long CreatedAt { get; set; }

    public required bool IsDeleted { get; set; }
}
