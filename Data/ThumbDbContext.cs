using Microsoft.EntityFrameworkCore;
using MiniSpace.Models;

namespace MiniSpace.Data;

public class ThumbDbContext(DbContextOptions<ThumbDbContext> options) : DbContext(options)
{
    public DbSet<Thumb> Thumbs => Set<Thumb>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var thumb = modelBuilder.Entity<Thumb>().ToTable("thumb");
        thumb.Property(t => t.Id).HasColumnName("id");
        thumb.Property(t => t.RawSha256).HasColumnName("raw_sha256");
        thumb.Property(t => t.Width).HasColumnName("width");
        thumb.Property(t => t.Height).HasColumnName("height");
        thumb.Property(t => t.Blob).HasColumnName("blob");
        thumb.HasIndex(t => new { t.RawSha256, t.Width, t.Height }).IsUnique();
    }
}
