using System.Diagnostics;

namespace MiniSpace.Repositories;

public sealed class MediaStore(string rootDirectory)
{
    public string PathFor(string sha256)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(rootDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(sha256);

        if (sha256.Length != 64)
        {
            throw new ArgumentException($"sha256 长度异常", nameof(sha256));
        }

        return Path.Combine(rootDirectory, sha256[..2], sha256[2..4], sha256);
    }
}
