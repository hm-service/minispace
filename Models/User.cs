namespace MiniSpace.Models;

public class User
{
    public int Id { get; set; }

    public required string UserId { get; set; }

    public required string Nickname { get; set; }

    public required string TokenHash { get; set; }
}
