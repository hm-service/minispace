namespace MiniSpace.Repositories;

public static class AuditLog
{
    private static string? _path;
    private static readonly object Gate = new();

    public static void Init(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        _path = path;
    }

    public static void Write(string message)
    {
        lock (Gate)
        {
            if (_path is null)
                return;
            File.AppendAllText(_path,
                $"{DateTimeOffset.UtcNow:yyyy-MM-ddTHH:mm:ss.fffZ} {message}{Environment.NewLine}");
        }
    }
}
