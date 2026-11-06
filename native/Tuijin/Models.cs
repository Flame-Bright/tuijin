using System.Text.Json.Serialization;

namespace Tuijin;

public sealed class AppData
{
    public int Version { get; set; } = 1;
    public List<TaskItem> Tasks { get; set; } = new();
    public AppSettings Settings { get; set; } = new();
    public AppMeta Meta { get; set; } = new();
}

public sealed class AppSnapshot
{
    public List<TaskItem> Tasks { get; set; } = new();
    public AppSettings Settings { get; set; } = new();
    public List<CategoryInfo> Categories { get; set; } = new();
    public AppMeta Meta { get; set; } = new();
}

public sealed class AppMeta
{
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.Now;
}

public sealed class AppSettings
{
    public string Theme { get; set; } = "light";
    public bool WidgetPinned { get; set; } = true;
    public BoundsInfo? WidgetBounds { get; set; }
    public BoundsInfo? MainBounds { get; set; }
    public string Sort { get; set; } = "manual";
    public string ComposerCategory { get; set; } = "life";
    public bool FirstRun { get; set; } = true;
    public bool Seeded { get; set; }

    /// <summary>界面缩放，1 = 标准。同时作用于工作台和桌面悬浮球。</summary>
    public double FontScale { get; set; } = 1.0;

    /// <summary>桌面形态：ball（悬浮球）、buddy（卡通人）或 custom（用户自己的图）。</summary>
    public string WidgetStyle { get; set; } = "ball";

    /// <summary>桌面浮层大小：small / medium / large。</summary>
    public string WidgetSize { get; set; } = "small";

    /// <summary>
    /// 「球的开关」：是否在桌面显示浮层（悬浮球 / 卡通人）。
    /// 默认开。关掉后桌面上完全不出现浮层，工作台照常可用；
    /// 工作台外观面板、托盘菜单、Alt + Shift + D 改的都是这一个字段。
    /// </summary>
    public bool WidgetVisible { get; set; } = true;

    /// <summary>强调色标识，见 AppSettings.Palette。</summary>
    public string Accent { get; set; } = "clay";

    public WallpaperSettings Wallpaper { get; set; } = new();

    /// <summary>桌面浮层用用户自己的图片替代卡通人。</summary>
    public WidgetCustomSettings WidgetCustom { get; set; } = new();
}

public sealed class WallpaperSettings
{
    /// <summary>none / preset / image</summary>
    public string Kind { get; set; } = "none";

    /// <summary>预设方案标识，见 AppSettings.Presets。</summary>
    public string Preset { get; set; } = "sunrise";

    /// <summary>自定义图片在壁纸目录里的文件名。</summary>
    public string? File { get; set; }

    /// <summary>压暗程度 0–0.8，让上面的字更清楚。</summary>
    public double Dim { get; set; } = 0.18;

    /// <summary>模糊半径（CSS px）0–24。</summary>
    public double Blur { get; set; } = 0;

    /// <summary>壁纸同时铺到工作台。</summary>
    public bool OnMain { get; set; } = true;
}

public sealed class WidgetCustomSettings
{
    /// <summary>自定义图片在 <data>/widget-custom/ 里的文件名，不含路径。空表示没选图。</summary>
    public string? File { get; set; }

    /// <summary>图片怎么铺：cover（铺满裁切）/ contain（完整显示）。</summary>
    public string Fit { get; set; } = "cover";

    /// <summary>压暗程度 0–0.6，让上面的字更清楚。</summary>
    public double Dim { get; set; } = 0.12;

    /// <summary>浮层上是否显示进度和文案。</summary>
    public bool ShowText { get; set; } = true;
}

public sealed class BoundsInfo
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }

    public Rectangle ToRectangle() => new(X, Y, Width, Height);

    public static BoundsInfo FromRectangle(Rectangle rectangle) => new()
    {
        X = rectangle.X,
        Y = rectangle.Y,
        Width = rectangle.Width,
        Height = rectangle.Height
    };
}

public sealed class CategoryInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Color { get; set; } = "";
}

/// <summary>外观相关取值的白名单，宿主和界面共用同一套标识。</summary>
public static class Appearance
{
    public static readonly string[] Accents = { "clay", "sage", "ocean", "plum", "amber", "ink" };

    public static readonly string[] Presets =
    {
        "sunrise", "dusk", "forest", "ocean", "paper", "night", "gradient", "web"
    };

    public static readonly string[] WidgetStyles = { "ball", "buddy", "custom" };

    /// <summary>自定义图片的铺法白名单。</summary>
    public static readonly string[] WidgetFits = { "cover", "contain" };

    /// <summary>浮层三档尺寸，数值是 ball 形态的直径；buddy / custom 按同比例换算。</summary>
    public static readonly string[] WidgetSizes = { "small", "medium", "large" };

    public const double MinScale = 0.8;
    public const double MaxScale = 1.6;

    public static string NormalizeAccent(string? value) =>
        value is not null && Accents.Contains(value) ? value : "clay";

    public static string NormalizePreset(string? value) =>
        value is not null && Presets.Contains(value) ? value : "sunrise";

    public static string NormalizeStyle(string? value) =>
        value is not null && WidgetStyles.Contains(value) ? value : "ball";

    public static string NormalizeWidgetSize(string? value) =>
        value is not null && WidgetSizes.Contains(value) ? value : "small";

    public static string NormalizeFit(string? value) =>
        value is not null && WidgetFits.Contains(value) ? value : "cover";

    /// <summary>ball 直径（DIP）。</summary>
    public static int BallDiameter(string size) => size switch
    {
        "large" => 168,
        "medium" => 148,
        _ => 116
    };

    /// <summary>buddy 尺寸（DIP）：宽 = 直径 × 1.29，高 = 宽 × 1.18。</summary>
    public static Size BuddySize(string size)
    {
        var diameter = BallDiameter(size);
        var width = (int)Math.Round(diameter * 1.29);
        return new Size(width, (int)Math.Round(width * 1.18));
    }

    /// <summary>
    /// 自定义图片形态的尺寸（DIP）：和 buddy 走同一套，随三档大小缩放。
    /// </summary>
    public static Size CustomSize(string size) => BuddySize(size);

    public static double NormalizeScale(double value) =>
        double.IsNaN(value) || double.IsInfinity(value)
            ? 1.0
            : Math.Round(Math.Clamp(value, MinScale, MaxScale), 2);
}

public sealed class TaskItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "";
    public string Note { get; set; } = "";
    public string Category { get; set; } = "life";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.Now;
    public string? DueDate { get; set; }
    public int Progress { get; set; }
    public int PrevProgress { get; set; }
    public bool AutoProgress { get; set; } = true;
    public List<Milestone> Milestones { get; set; } = new();
    public string Status { get; set; } = "active";
    public DateTimeOffset? CompletedAt { get; set; }
    public double Order { get; set; }

    [JsonIgnore]
    public bool IsDone => Status == "done";
}

public sealed class Milestone
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "";
    public bool Done { get; set; }
    public string? DueDate { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
    public DateTimeOffset? DoneAt { get; set; }
}
