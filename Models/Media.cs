namespace MiniSpace.Models;

public class Media
{
    public int Id { get; set; }

    public required string Sha256 { get; set; }

    public required string Mime { get; set; }

    public required long Size { get; set; }

    public required int Width { get; set; }

    public required int Height { get; set; }
}
