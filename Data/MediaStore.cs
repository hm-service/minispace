namespace MiniSpace.Data;

public static class MediaStore
{
    public static string PathFor(string root, string sha256)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sha256);
        if (sha256.Length < 4)
            throw new ArgumentException("sha256 长度不足", nameof(sha256));
        return Path.Combine(root, sha256[..2], sha256[2..4], sha256);
    }
}
