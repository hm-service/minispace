namespace MiniSpace.Models;

public class User
{
    public int Id { get; set; }
    public required string UserId { get; set; }
    public required string Nickname { get; set; }
    public required string TokenHash { get; set; }
}

public class Post
{
    public int Id { get; set; }
    public required string PostId { get; set; }
    public required string UserId { get; set; }
    public User? User { get; set; }
    public required string TextContent { get; set; }
    public required string MediaContent { get; set; }
    public long CreatedAt { get; set; }
    public bool IsDeleted { get; set; }
}

public class Comment
{
    public int Id { get; set; }
    public required string CommentId { get; set; }
    public required string PostId { get; set; }
    public Post? Post { get; set; }
    public required string UserId { get; set; }
    public User? User { get; set; }
    public required string Content { get; set; }
    public long CreatedAt { get; set; }
    public bool IsDeleted { get; set; }
}

public class Media
{
    public int Id { get; set; }
    public required string Sha256 { get; set; }
    public required string Mime { get; set; }
    public long Size { get; set; }
}
