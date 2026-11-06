using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Tuijin;

public sealed class StoreException : Exception
{
    public StoreException(string message) : base(message)
    {
    }
}

public sealed class TaskStore
{
    public static readonly JsonSerializerOptions FileJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static readonly JsonSerializerOptions WireJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static readonly IReadOnlyList<CategoryInfo> Categories = new List<CategoryInfo>
    {
        new() { Id = "work", Name = "工作", Color = "#D96C47" },
        new() { Id = "life", Name = "生活", Color = "#6F8F6B" },
        new() { Id = "study", Name = "学习", Color = "#5B7FA8" },
        new() { Id = "idea", Name = "灵感", Color = "#A8739D" }
    };

    private static readonly HashSet<string> CategoryIds = new(StringComparer.Ordinal)
    {
        "work", "life", "study", "idea"
    };

    private static readonly HashSet<string> SortIds = new(StringComparer.Ordinal)
    {
        "manual", "due", "progress"
    };

    private readonly string _backupPath;
    private AppData _data;

    public TaskStore(string dataPath)
    {
        DataPath = dataPath;
        _backupPath = dataPath + ".bak";
        _data = Load();
        if (!_data.Settings.Seeded)
        {
            _data.Tasks.Add(CreateSeedTask());
            _data.Settings.Seeded = true;
        }
        Persist();
    }

    public string DataPath { get; }

    public AppData Data => _data;

    public event Action? Changed;

    public AppSnapshot Snapshot() => new()
    {
        Tasks = _data.Tasks,
        Settings = _data.Settings,
        Categories = Categories.ToList(),
        Meta = _data.Meta
    };

    private AppData Load()
    {
        try
        {
            if (!File.Exists(DataPath))
            {
                return NewData();
            }

            var json = File.ReadAllText(DataPath);
            var data = JsonSerializer.Deserialize<AppData>(json, FileJson) ?? NewData();
            return Normalize(data);
        }
        catch (Exception error)
        {
            Log.Write("STORE LOAD ERROR " + error);
            try
            {
                if (File.Exists(DataPath))
                {
                    File.Copy(DataPath, $"{DataPath}.corrupt-{DateTime.Now:yyyyMMddHHmmss}", true);
                }
            }
            catch
            {
            }
            return NewData();
        }
    }

    private static AppData NewData() => new()
    {
        Version = 1,
        Tasks = new List<TaskItem>(),
        Settings = new AppSettings(),
        Meta = new AppMeta()
    };

    private static AppData Normalize(AppData data)
    {
        var now = DateTimeOffset.Now;
        data.Version = 1;
        data.Tasks ??= new List<TaskItem>();
        data.Settings ??= new AppSettings();
        data.Meta ??= new AppMeta();

        if (data.Meta.CreatedAt == default) data.Meta.CreatedAt = now;
        if (data.Meta.UpdatedAt == default) data.Meta.UpdatedAt = data.Meta.CreatedAt;

        var settings = data.Settings;
        settings.Theme = settings.Theme == "dark" ? "dark" : "light";
        settings.Sort = SortIds.Contains(settings.Sort) ? settings.Sort : "manual";
        settings.ComposerCategory = CategoryIds.Contains(settings.ComposerCategory)
            ? settings.ComposerCategory
            : "life";
        settings.WidgetBounds = NormalizeBounds(settings.WidgetBounds);
        settings.MainBounds = NormalizeBounds(settings.MainBounds);

        settings.FontScale = Appearance.NormalizeScale(settings.FontScale);
        settings.WidgetStyle = Appearance.NormalizeStyle(settings.WidgetStyle);
        settings.WidgetSize = Appearance.NormalizeWidgetSize(settings.WidgetSize);
        settings.Accent = Appearance.NormalizeAccent(settings.Accent);
        settings.Wallpaper = NormalizeWallpaper(settings.Wallpaper);
        settings.WidgetCustom = NormalizeWidgetCustom(settings.WidgetCustom);

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var tasks = new List<TaskItem>();
        foreach (var task in data.Tasks.Take(500))
        {
            if (task is null) continue;
            task.Id = string.IsNullOrWhiteSpace(task.Id) || !seen.Add(task.Id)
                ? Guid.NewGuid().ToString()
                : task.Id;
            seen.Add(task.Id);

            task.Title = CleanTitle(task.Title, 120);
            if (task.Title.Length == 0) task.Title = "未命名的事";
            task.Note = CleanText(task.Note, 3000);
            task.Category = CategoryIds.Contains(task.Category) ? task.Category : "life";
            if (task.CreatedAt == default) task.CreatedAt = now;
            if (task.UpdatedAt == default) task.UpdatedAt = task.CreatedAt;
            task.DueDate = CleanDate(task.DueDate);
            task.Status = task.Status == "done" ? "done" : "active";
            task.Progress = Math.Clamp(task.Progress, 0, 100);
            task.PrevProgress = Math.Clamp(task.PrevProgress, 0, 100);
            task.Milestones ??= new List<Milestone>();

            var milestoneIds = new HashSet<string>(StringComparer.Ordinal);
            var milestones = new List<Milestone>();
            foreach (var milestone in task.Milestones.Take(100))
            {
                if (milestone is null) continue;
                milestone.Id = string.IsNullOrWhiteSpace(milestone.Id) || !milestoneIds.Add(milestone.Id)
                    ? Guid.NewGuid().ToString()
                    : milestone.Id;
                milestoneIds.Add(milestone.Id);
                milestone.Title = CleanTitle(milestone.Title, 120);
                if (milestone.Title.Length == 0) milestone.Title = "未命名节点";
                milestone.DueDate = CleanDate(milestone.DueDate);
                if (milestone.CreatedAt == default) milestone.CreatedAt = task.CreatedAt;
                if (milestone.Done && milestone.DoneAt is null) milestone.DoneAt = task.UpdatedAt;
                if (!milestone.Done) milestone.DoneAt = null;
                milestones.Add(milestone);
            }
            task.Milestones = milestones;

            if (task.Milestones.Count == 0)
            {
                task.AutoProgress = false;
            }
            if (task.AutoProgress)
            {
                task.Progress = ProgressFromMilestones(task.Milestones);
            }
            if (task.Status == "done")
            {
                task.Progress = 100;
                task.CompletedAt ??= task.UpdatedAt;
            }
            else
            {
                task.CompletedAt = null;
            }

            if (double.IsNaN(task.Order) || double.IsInfinity(task.Order)) task.Order = tasks.Count;
            tasks.Add(task);
        }

        data.Tasks = tasks;
        return data;
    }

    private static BoundsInfo? NormalizeBounds(BoundsInfo? bounds)
    {
        if (bounds is null) return null;
        if (bounds.Width < 300 || bounds.Height < 420) return null;
        return new BoundsInfo
        {
            X = bounds.X,
            Y = bounds.Y,
            Width = bounds.Width,
            Height = bounds.Height
        };
    }

    private static WallpaperSettings NormalizeWallpaper(WallpaperSettings? wallpaper)
    {
        if (wallpaper is null) return new WallpaperSettings();

        var kind = wallpaper.Kind switch
        {
            "preset" or "image" => wallpaper.Kind,
            _ => "none"
        };

        // 选了图片却没有文件名，等于没选。
        if (kind == "image" && string.IsNullOrWhiteSpace(wallpaper.File)) kind = "none";

        return new WallpaperSettings
        {
            Kind = kind,
            Preset = Appearance.NormalizePreset(wallpaper.Preset),
            File = string.IsNullOrWhiteSpace(wallpaper.File) ? null : Path.GetFileName(wallpaper.File),
            Dim = double.IsNaN(wallpaper.Dim) ? 0.18 : Math.Round(Math.Clamp(wallpaper.Dim, 0, 0.8), 2),
            Blur = double.IsNaN(wallpaper.Blur) ? 0 : Math.Round(Math.Clamp(wallpaper.Blur, 0, 24), 1),
            OnMain = wallpaper.OnMain
        };
    }

    private static WidgetCustomSettings NormalizeWidgetCustom(WidgetCustomSettings? custom)
    {
        if (custom is null) return new WidgetCustomSettings();

        return new WidgetCustomSettings
        {
            // 只存文件名，防止旧数据里带了路径
            File = string.IsNullOrWhiteSpace(custom.File) ? null : Path.GetFileName(custom.File),
            Fit = Appearance.NormalizeFit(custom.Fit),
            Dim = double.IsNaN(custom.Dim) ? 0.12 : Math.Round(Math.Clamp(custom.Dim, 0, 0.6), 2),
            ShowText = custom.ShowText
        };
    }

    private static TaskItem CreateSeedTask()
    {
        var now = DateTimeOffset.Now;
        return new TaskItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = "把最近想做的一件事写下来",
            Note = "点开这张卡片，把标题换成你真正想推进的事。模糊不要紧，先写下来，再拆出下一小步。",
            Category = "life",
            CreatedAt = now,
            UpdatedAt = now,
            Progress = 0,
            PrevProgress = 0,
            AutoProgress = true,
            Status = "active",
            Order = -1,
            Milestones = new List<Milestone>
            {
                new()
                {
                    Id = Guid.NewGuid().ToString(),
                    Title = "把这件事写成一句具体的话",
                    CreatedAt = now
                },
                new()
                {
                    Id = Guid.NewGuid().ToString(),
                    Title = "拆出一个 30 分钟内能开始的下一步",
                    CreatedAt = now.AddSeconds(1)
                },
                new()
                {
                    Id = Guid.NewGuid().ToString(),
                    Title = "给它定一个想完成的日期",
                    CreatedAt = now.AddSeconds(2)
                }
            }
        };
    }

    private void Persist()
    {
        try
        {
            var directory = Path.GetDirectoryName(DataPath);
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            if (File.Exists(DataPath))
            {
                try
                {
                    File.Copy(DataPath, _backupPath, true);
                }
                catch
                {
                }
            }
            var temp = DataPath + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(_data, FileJson));
            File.Move(temp, DataPath, true);
        }
        catch (Exception error)
        {
            Log.Write("STORE SAVE ERROR " + error);
        }
    }

    private void Touch()
    {
        _data.Meta.UpdatedAt = DateTimeOffset.Now;
        Persist();
        Changed?.Invoke();
    }

    private static string CleanText(string? value, int maxLength)
    {
        if (string.IsNullOrEmpty(value)) return "";
        value = value.Replace("\r\n", "\n").TrimStart();
        return value.Length > maxLength ? value[..maxLength] : value;
    }

    private static string CleanTitle(string? value, int maxLength = 120)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var compact = string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return compact.Length > maxLength ? compact[..maxLength] : compact;
    }

    private static string? CleanDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : null;
    }

    private static int ProgressFromMilestones(IReadOnlyCollection<Milestone> milestones)
    {
        if (milestones.Count == 0) return 0;
        return (int)Math.Round(milestones.Count(item => item.Done) * 100.0 / milestones.Count);
    }

    private static string? JsonString(JsonElement element) =>
        element.ValueKind == JsonValueKind.String ? element.GetString() : null;

    private static int JsonInt(JsonElement element, int fallback)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value)) return value;
        return fallback;
    }

    private static bool JsonBool(JsonElement element, bool fallback) => element.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => fallback
    };

    private TaskItem GetTask(string id)
    {
        return _data.Tasks.FirstOrDefault(task => task.Id == id)
               ?? throw new StoreException("没有找到这件事");
    }

    public string CreateTask(JsonElement input)
    {
        var title = CleanTitle(JsonString(GetProperty(input, "title")));
        if (title.Length == 0) throw new StoreException("先写下一件想做的事");

        var categoryValue = JsonString(GetProperty(input, "category"));
        var category = !string.IsNullOrWhiteSpace(categoryValue) && CategoryIds.Contains(categoryValue)
            ? categoryValue
            : _data.Settings.ComposerCategory;

        var now = DateTimeOffset.Now;
        var task = new TaskItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = title,
            Note = CleanText(JsonString(GetProperty(input, "note")), 3000),
            Category = category,
            CreatedAt = now,
            UpdatedAt = now,
            DueDate = CleanDate(JsonString(GetProperty(input, "dueDate"))),
            Progress = 0,
            PrevProgress = 0,
            AutoProgress = true,
            Milestones = new List<Milestone>(),
            Status = "active",
            CompletedAt = null,
            Order = _data.Tasks.Count == 0 ? 0 : _data.Tasks.Min(item => item.Order) - 1
        };
        _data.Tasks.Add(task);
        Touch();
        return task.Id;
    }

    public void UpdateTask(string id, JsonElement patch)
    {
        var task = GetTask(id);
        if (patch.ValueKind != JsonValueKind.Object) return;

        if (patch.TryGetProperty("title", out var titleElement))
        {
            var title = CleanTitle(JsonString(titleElement));
            if (title.Length > 0) task.Title = title;
        }
        if (patch.TryGetProperty("note", out var noteElement))
        {
            task.Note = CleanText(JsonString(noteElement), 3000);
        }
        if (patch.TryGetProperty("category", out var categoryElement))
        {
            var category = JsonString(categoryElement);
            if (!string.IsNullOrWhiteSpace(category) && CategoryIds.Contains(category)) task.Category = category;
        }
        if (patch.TryGetProperty("dueDate", out var dueElement))
        {
            task.DueDate = CleanDate(JsonString(dueElement));
        }
        if (patch.TryGetProperty("progress", out var progressElement))
        {
            task.Progress = Math.Clamp(JsonInt(progressElement, task.Progress), 0, 100);
            if (!patch.TryGetProperty("autoProgress", out _)) task.AutoProgress = false;
        }
        if (patch.TryGetProperty("autoProgress", out var autoElement))
        {
            task.AutoProgress = JsonBool(autoElement, task.AutoProgress) && task.Milestones.Count > 0;
            if (task.AutoProgress) Recalculate(task);
        }

        task.UpdatedAt = DateTimeOffset.Now;
        Touch();
    }

    public void DeleteTask(string id)
    {
        var task = GetTask(id);
        _data.Tasks.Remove(task);
        Touch();
    }

    public void ToggleTaskDone(string id)
    {
        var task = GetTask(id);
        var now = DateTimeOffset.Now;
        if (task.Status == "active")
        {
            task.PrevProgress = task.Progress;
            task.Status = "done";
            task.Progress = 100;
            task.CompletedAt = now;
        }
        else
        {
            task.Status = "active";
            task.CompletedAt = null;
            task.Progress = task.AutoProgress && task.Milestones.Count > 0
                ? ProgressFromMilestones(task.Milestones)
                : Math.Clamp(task.PrevProgress, 0, 100);
        }
        task.UpdatedAt = now;
        Touch();
    }

    public void AddMilestone(string taskId, JsonElement input)
    {
        var task = GetTask(taskId);
        var title = CleanTitle(JsonString(GetProperty(input, "title")));
        if (title.Length == 0) throw new StoreException("先写下一个节点");

        if (task.Milestones.Count == 0 && task.Progress == 0 && !task.AutoProgress)
        {
            task.AutoProgress = true;
        }

        task.Milestones.Add(new Milestone
        {
            Id = Guid.NewGuid().ToString(),
            Title = title,
            Done = false,
            DueDate = CleanDate(JsonString(GetProperty(input, "dueDate"))),
            CreatedAt = DateTimeOffset.Now
        });
        Recalculate(task);
        task.AutoProgress = task.AutoProgress && task.Milestones.Count > 0;
        task.UpdatedAt = DateTimeOffset.Now;
        Touch();
    }

    public void UpdateMilestone(string taskId, string milestoneId, JsonElement patch)
    {
        var task = GetTask(taskId);
        var milestone = task.Milestones.FirstOrDefault(item => item.Id == milestoneId)
                        ?? throw new StoreException("没有找到这个节点");

        if (patch.TryGetProperty("title", out var titleElement))
        {
            var title = CleanTitle(JsonString(titleElement));
            if (title.Length > 0) milestone.Title = title;
        }
        if (patch.TryGetProperty("dueDate", out var dueElement))
        {
            milestone.DueDate = CleanDate(JsonString(dueElement));
        }

        task.UpdatedAt = DateTimeOffset.Now;
        Touch();
    }

    public void ToggleMilestone(string taskId, string milestoneId)
    {
        var task = GetTask(taskId);
        var milestone = task.Milestones.FirstOrDefault(item => item.Id == milestoneId)
                        ?? throw new StoreException("没有找到这个节点");

        milestone.Done = !milestone.Done;
        milestone.DoneAt = milestone.Done ? DateTimeOffset.Now : null;
        Recalculate(task);
        task.UpdatedAt = DateTimeOffset.Now;
        Touch();
    }

    public void DeleteMilestone(string taskId, string milestoneId)
    {
        var task = GetTask(taskId);
        var milestone = task.Milestones.FirstOrDefault(item => item.Id == milestoneId)
                        ?? throw new StoreException("没有找到这个节点");
        task.Milestones.Remove(milestone);
        if (task.Milestones.Count == 0) task.AutoProgress = false;
        else Recalculate(task);
        task.UpdatedAt = DateTimeOffset.Now;
        Touch();
    }

    public void ClearCompleted()
    {
        _data.Tasks.RemoveAll(task => task.Status == "done");
        Touch();
    }

    public void UpdateSettings(JsonElement patch)
    {
        if (patch.ValueKind != JsonValueKind.Object) return;
        var settings = _data.Settings;

        if (patch.TryGetProperty("theme", out var themeElement))
        {
            var theme = JsonString(themeElement);
            if (theme is "light" or "dark") settings.Theme = theme;
        }
        if (patch.TryGetProperty("widgetPinned", out var pinElement))
        {
            settings.WidgetPinned = JsonBool(pinElement, settings.WidgetPinned);
        }
        if (patch.TryGetProperty("widgetVisible", out var visibleElement))
        {
            settings.WidgetVisible = JsonBool(visibleElement, settings.WidgetVisible);
        }
        if (patch.TryGetProperty("widgetBounds", out var widgetBounds))
        {
            settings.WidgetBounds = ReadBounds(widgetBounds) ?? settings.WidgetBounds;
        }
        if (patch.TryGetProperty("mainBounds", out var mainBounds))
        {
            settings.MainBounds = ReadBounds(mainBounds) ?? settings.MainBounds;
        }
        if (patch.TryGetProperty("sort", out var sortElement))
        {
            var sort = JsonString(sortElement);
            if (!string.IsNullOrWhiteSpace(sort) && SortIds.Contains(sort)) settings.Sort = sort;
        }
        if (patch.TryGetProperty("composerCategory", out var categoryElement))
        {
            var category = JsonString(categoryElement);
            if (!string.IsNullOrWhiteSpace(category) && CategoryIds.Contains(category))
            {
                settings.ComposerCategory = category;
            }
        }
        if (patch.TryGetProperty("firstRun", out var firstRunElement))
        {
            settings.FirstRun = JsonBool(firstRunElement, settings.FirstRun);
        }
        if (patch.TryGetProperty("seeded", out var seededElement))
        {
            settings.Seeded = JsonBool(seededElement, settings.Seeded);
        }
        if (patch.TryGetProperty("fontScale", out var scaleElement)
            && scaleElement.ValueKind == JsonValueKind.Number
            && scaleElement.TryGetDouble(out var scale))
        {
            settings.FontScale = Appearance.NormalizeScale(scale);
        }
        if (patch.TryGetProperty("widgetStyle", out var styleElement))
        {
            var style = JsonString(styleElement);
            if (!string.IsNullOrWhiteSpace(style) && Appearance.WidgetStyles.Contains(style))
            {
                settings.WidgetStyle = style;
            }
        }
        if (patch.TryGetProperty("widgetSize", out var sizeElement))
        {
            var size = JsonString(sizeElement);
            if (!string.IsNullOrWhiteSpace(size) && Appearance.WidgetSizes.Contains(size))
            {
                settings.WidgetSize = size;
            }
        }
        if (patch.TryGetProperty("accent", out var accentElement))
        {
            var accent = JsonString(accentElement);
            if (!string.IsNullOrWhiteSpace(accent) && Appearance.Accents.Contains(accent))
            {
                settings.Accent = accent;
            }
        }
        if (patch.TryGetProperty("wallpaper", out var wallpaperElement)
            && wallpaperElement.ValueKind == JsonValueKind.Object)
        {
            settings.Wallpaper = MergeWallpaper(settings.Wallpaper, wallpaperElement);
        }
        if (patch.TryGetProperty("widgetCustom", out var customElement)
            && customElement.ValueKind == JsonValueKind.Object)
        {
            settings.WidgetCustom = MergeWidgetCustom(settings.WidgetCustom, customElement);
        }

        Touch();
    }

    private static WallpaperSettings MergeWallpaper(WallpaperSettings current, JsonElement patch)
    {
        var kind = current.Kind;
        var preset = current.Preset;
        var file = current.File;
        var dim = current.Dim;
        var blur = current.Blur;
        var onMain = current.OnMain;

        if (patch.TryGetProperty("kind", out var kindElement))
        {
            var value = JsonString(kindElement);
            if (value is "none" or "preset" or "image") kind = value;
        }
        if (patch.TryGetProperty("preset", out var presetElement))
        {
            var value = JsonString(presetElement);
            if (!string.IsNullOrWhiteSpace(value)) preset = Appearance.NormalizePreset(value);
        }
        if (patch.TryGetProperty("file", out var fileElement))
        {
            if (fileElement.ValueKind == JsonValueKind.Null) file = null;
            else file = Path.GetFileName(JsonString(fileElement));
        }
        if (patch.TryGetProperty("dim", out var dimElement)
            && dimElement.ValueKind == JsonValueKind.Number
            && dimElement.TryGetDouble(out var dimValue))
        {
            dim = dimValue;
        }
        if (patch.TryGetProperty("blur", out var blurElement)
            && blurElement.ValueKind == JsonValueKind.Number
            && blurElement.TryGetDouble(out var blurValue))
        {
            blur = blurValue;
        }
        if (patch.TryGetProperty("onMain", out var onMainElement))
        {
            onMain = JsonBool(onMainElement, onMain);
        }

        return NormalizeWallpaper(new WallpaperSettings
        {
            Kind = kind,
            Preset = preset,
            File = file,
            Dim = dim,
            Blur = blur,
            OnMain = onMain
        });
    }

    private static WidgetCustomSettings MergeWidgetCustom(WidgetCustomSettings current, JsonElement patch)
    {
        var file = current.File;
        var fit = current.Fit;
        var dim = current.Dim;
        var showText = current.ShowText;

        if (patch.TryGetProperty("file", out var fileElement))
        {
            // 传 null 就是「不要这张图了」，和 wallpaper 的处理保持一致
            if (fileElement.ValueKind == JsonValueKind.Null) file = null;
            else file = Path.GetFileName(JsonString(fileElement));
        }
        if (patch.TryGetProperty("fit", out var fitElement))
        {
            var value = JsonString(fitElement);
            if (!string.IsNullOrWhiteSpace(value)) fit = Appearance.NormalizeFit(value);
        }
        if (patch.TryGetProperty("dim", out var dimElement)
            && dimElement.ValueKind == JsonValueKind.Number
            && dimElement.TryGetDouble(out var dimValue))
        {
            dim = dimValue;
        }
        if (patch.TryGetProperty("showText", out var showTextElement))
        {
            showText = JsonBool(showTextElement, showText);
        }

        return NormalizeWidgetCustom(new WidgetCustomSettings
        {
            File = file,
            Fit = fit,
            Dim = dim,
            ShowText = showText
        });
    }

    public void SetWindowBounds(string key, Rectangle bounds)
    {
        // 悬浮球比工作台小得多，最小尺寸要求分开
        var minimum = key == "widgetBounds" ? 60 : 300;
        if (bounds.Width < minimum || bounds.Height < minimum) return;
        var info = BoundsInfo.FromRectangle(bounds);
        if (key == "widgetBounds") _data.Settings.WidgetBounds = info;
        else if (key == "mainBounds") _data.Settings.MainBounds = info;
        else return;
        Persist();
    }

    public void MarkStarted()
    {
        if (!_data.Settings.FirstRun) return;
        _data.Settings.FirstRun = false;
        Persist();
        Changed?.Invoke();
    }

    public void SetWidgetPinned(bool pinned)
    {
        if (_data.Settings.WidgetPinned == pinned) return;
        _data.Settings.WidgetPinned = pinned;
        Touch();
    }

    /// <summary>
    /// 「球的开关」。宿主和界面都只认这一个字段：
    /// 工作台外观面板、托盘菜单、Alt + Shift + D、浮层里的「隐藏」全部落到这里。
    /// </summary>
    public void SetWidgetVisible(bool visible)
    {
        if (_data.Settings.WidgetVisible == visible) return;
        _data.Settings.WidgetVisible = visible;
        Touch();
    }

    public void Flush()
    {
        Persist();
    }

    private static BoundsInfo? ReadBounds(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        try
        {
            var bounds = element.Deserialize<BoundsInfo>(WireJson);
            return bounds is { Width: >= 300, Height: >= 420 } ? bounds : null;
        }
        catch
        {
            return null;
        }
    }

    private static JsonElement GetProperty(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value))
        {
            return value;
        }
        return default;
    }

    private static void Recalculate(TaskItem task)
    {
        if (task.AutoProgress && task.Milestones.Count > 0)
        {
            task.Progress = ProgressFromMilestones(task.Milestones);
        }
    }
}
