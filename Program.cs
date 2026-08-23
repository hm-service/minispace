using Microsoft.EntityFrameworkCore;
using MiniSpace.Data;
using MiniSpace.Endpoints;

var builder = WebApplication.CreateBuilder(args);

var contentRoot = builder.Environment.ContentRootPath;
var dataDir = Environment.GetEnvironmentVariable("DATA_DIR");
if (string.IsNullOrWhiteSpace(dataDir))
{
    dataDir = Path.Combine(contentRoot, "data");
}

Directory.CreateDirectory(dataDir);
AuditLog.Init(Path.Combine(dataDir, "log.txt"));

builder.Services
    .AddDbContext<AppDbContext>(
        o => o.UseSqlite($"Data Source={Path.Combine(dataDir, "data.db")}"))
    .AddDbContext<ThumbDbContext>(
        o => o.UseSqlite($"Data Source={Path.Combine(dataDir, "thumb.db")}"))
    .AddOpenApi();

var app = builder.Build();

var mediaDir = Path.Combine(dataDir, "static");
Directory.CreateDirectory(mediaDir);

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    if (app.Environment.IsDevelopment())
        await DbSeeder.SeedAsync(db);
    var tdb = scope.ServiceProvider.GetRequiredService<ThumbDbContext>();
    tdb.Database.EnsureCreated();
    await UserSync.SyncAsync(db, Path.Combine(dataDir, "users.json"));
}

app.UseDefaultFiles();
app.Use(async (context, next) =>
{
    // 防点击劫持：禁止被 iframe 嵌入（frame-ancestors 为现代替代，X-Frame-Options 兜底旧浏览器）
    context.Response.Headers.XFrameOptions = "DENY";
    context.Response.Headers.ContentSecurityPolicy = "frame-ancestors 'none'";
    // SPA 路由（/auth、/posts/... 等无扩展名路径）一律 no-cache，确保拿到最新的 index.html
    if (!(context.Request.Path.Value ?? "").Contains('.'))
        context.Response.Headers.CacheControl = "no-cache";
    await next();
});
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapAuthEndpoints();
app.MapPostEndpoints();
app.MapCommentEndpoints();
app.MapMediaEndpoints(mediaDir);
app.MapFallbackToFile("index.html");

app.Run();
