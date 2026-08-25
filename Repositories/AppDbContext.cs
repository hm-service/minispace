using Microsoft.EntityFrameworkCore;
using MiniSpace.Models;

namespace MiniSpace.Repositories;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Media> Media => Set<Media>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var user = modelBuilder.Entity<User>().ToTable("user");
        user.Property(u => u.Id).HasColumnName("id");
        user.Property(u => u.UserId).HasColumnName("user_id");
        user.Property(u => u.Nickname).HasColumnName("nickname");
        user.Property(u => u.TokenHash).HasColumnName("token_hash");
        user.HasIndex(u => u.UserId).IsUnique();
        user.HasIndex(u => u.TokenHash).IsUnique();

        var post = modelBuilder.Entity<Post>().ToTable("post");
        post.Property(p => p.Id).HasColumnName("id");
        post.Property(p => p.PostId).HasColumnName("post_id");
        post.Property(p => p.UserId).HasColumnName("user_id");
        post.Property(p => p.TextContent).HasColumnName("text_content");
        post.Property(p => p.MediaContent).HasColumnName("media_content");
        post.Property(p => p.CreatedAt).HasColumnName("created_at");
        post.Property(p => p.IsDeleted).HasColumnName("is_deleted");
        post.HasIndex(p => p.PostId).IsUnique();
        post.HasIndex(p => p.UserId);

        var comment = modelBuilder.Entity<Comment>().ToTable("comment");
        comment.Property(c => c.Id).HasColumnName("id");
        comment.Property(c => c.CommentId).HasColumnName("comment_id");
        comment.Property(c => c.PostId).HasColumnName("post_id");
        comment.Property(c => c.UserId).HasColumnName("user_id");
        comment.Property(c => c.Content).HasColumnName("content");
        comment.Property(c => c.CreatedAt).HasColumnName("created_at");
        comment.Property(c => c.IsDeleted).HasColumnName("is_deleted");
        comment.HasIndex(c => c.CommentId).IsUnique();
        comment.HasIndex(c => c.PostId);

        var media = modelBuilder.Entity<Media>().ToTable("media");
        media.Property(m => m.Id).HasColumnName("id");
        media.Property(m => m.Sha256).HasColumnName("sha256");
        media.Property(m => m.Mime).HasColumnName("mime");
        media.Property(m => m.Size).HasColumnName("size");
        media.Property(m => m.Width).HasColumnName("width");
        media.Property(m => m.Height).HasColumnName("height");
        media.HasIndex(m => m.Sha256).IsUnique();
    }
}
