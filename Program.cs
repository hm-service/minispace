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
}

app.UseDefaultFiles();
app.Use(async (context, next) =>
{
    if (context.Request.Path == "/" || context.Request.Path == "/index.html")
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

app.Run();
