namespace MiniSpace.Models;

public class Comment
{
    public int Id { get; set; }

    public required string CommentId { get; set; }

    public required string PostId { get; set; }

    public required string UserId { get; set; }

    public required string Content { get; set; }

    public required long CreatedAt { get; set; }

    public required bool IsDeleted { get; set; }
}
