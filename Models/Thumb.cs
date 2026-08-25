namespace MiniSpace.Models;

public class Thumb
{
    public int Id { get; set; }

    public required string RawSha256 { get; set; }

    public required int Width { get; set; }

    public required int Height { get; set; }

    public required byte[] Blob { get; set; }
}
