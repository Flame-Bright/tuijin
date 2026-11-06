using System.ComponentModel;

namespace Tuijin;

public sealed class MainForm : WebWindow
{
    public MainForm(AppHost host) : base(host)
    {
        Text = "推进";
        Name = "MainForm";
        ShowInTaskbar = true;
        // 允许拖到比较小，窄窗有专门的响应式布局
        MinimumSize = new Size(AppHost.Scale(560), AppHost.Scale(480));
        Size = new Size(AppHost.Scale(1235), AppHost.Scale(820));
    }

    public override string PageName => "index.html";

    /// <summary>工作台要能拖拽边缘缩放。</summary>
    protected override bool UseResizeBorder => true;

    private Rectangle? _pendingBounds;

    /// <summary>
    /// 记下首次显示的目标位置与大小。
    /// 构造阶段赋值会被 AutoScaleMode.Dpi 再缩放一次，导致窗口偏小；
    /// 所以先存起来，等句柄建好后再真正应用。
    /// </summary>
    public void SetInitialBounds(Rectangle bounds)
    {
        _pendingBounds = bounds;
        if (IsHandleCreated) ApplyPendingBounds();
    }

    private void ApplyPendingBounds()
    {
        if (_pendingBounds is not { } bounds) return;
        _pendingBounds = null;
        Bounds = bounds;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyPendingBounds();
    }

    [Browsable(false)]
    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public string? PendingFocus { get; set; }

    public void RequestFocus(string? taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId)) return;
        PendingFocus = taskId;
        FlushFocus();
    }

    public void FlushFocus()
    {
        if (string.IsNullOrWhiteSpace(PendingFocus) || !WebReady) return;
        var taskId = PendingFocus;
        PendingFocus = null;
        PostMessage(new { type = "focus-task", taskId });
    }

    protected override void OnPageReady()
    {
        FlushFocus();
        PostMaximizedState();
    }

    public void ShowAndActivate()
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
        BringToFront();
    }
}

public enum WidgetMode
{
    Ball,
    Buddy,
    Custom,
    Expanded
}

public sealed class WidgetForm : WebWindow
{
    public WidgetForm(AppHost host) : base(host)
    {
        Text = "推进";
        Name = "WidgetForm";
        ShowInTaskbar = false;
        FormBorderStyle = FormBorderStyle.None;
        ApplyMode(ModeFromStyle(host.Store.Data.Settings.WidgetStyle));
        TopMost = host.Store.Data.Settings.WidgetPinned;
    }

    public override string PageName => "widget.html";

    protected override bool ToolWindow => true;

    protected override bool UseRoundedCorners => false;

    /// <summary>当前形态。</summary>
    public WidgetMode Mode { get; private set; } = WidgetMode.Ball;

    /// <summary>当前大小档位（small / medium / large）。</summary>
    private string WidgetSize => Host.Store.Data.Settings.WidgetSize;

    private Size CurrentSize(WidgetMode mode) => ModeSize(mode, WidgetSize);

    /// <summary>形态变化后通知界面切换布局。</summary>
    public void SetMode(WidgetMode mode, bool keepCenter = true)
    {
        if (Mode == mode) return;
        var before = Bounds;
        ApplyMode(mode);
        var size = CurrentSize(mode);
        var location = keepCenter
            ? new Point(before.X + (before.Width - size.Width) / 2,
                        before.Y + (before.Height - size.Height) / 2)
            : new Point(before.X, before.Y);
        Bounds = new Rectangle(ClampToWorkArea(location, size), size);
        Reshape();
        PostMessage(new { type = "widget-mode", mode = ModeName(mode) });
    }

    /// <summary>只改大小档位，形态不变。</summary>
    public void ApplyWidgetSize()
    {
        if (_widgetExpanded) return;
        var before = Bounds;
        ApplyMode(Mode);
        var size = CurrentSize(Mode);
        var location = new Point(
            before.X + (before.Width - size.Width) / 2,
            before.Y + (before.Height - size.Height) / 2);
        Bounds = new Rectangle(ClampToWorkArea(location, size), size);
        Reshape();
        PostMessage(new { type = "widget-mode", mode = ModeName(Mode) });
    }

    private bool _widgetExpanded => Mode == WidgetMode.Expanded;

    /// <summary>把设置里的形态标识换成窗口形态，三选一。</summary>
    public static WidgetMode ModeFromStyle(string? style) => Appearance.NormalizeStyle(style) switch
    {
        "buddy" => WidgetMode.Buddy,
        "custom" => WidgetMode.Custom,
        _ => WidgetMode.Ball
    };

    public static string ModeName(WidgetMode mode) => mode switch
    {
        WidgetMode.Buddy => "buddy",
        WidgetMode.Custom => "custom",
        WidgetMode.Expanded => "expanded",
        _ => "ball"
    };

    /// <summary>收起态尺寸，随设置里的三档大小变化。</summary>
    public static Size ModeSize(WidgetMode mode, string widgetSize = "small") => mode switch
    {
        WidgetMode.Buddy => ScaleSize(Appearance.BuddySize(widgetSize)),
        WidgetMode.Custom => ScaleSize(Appearance.CustomSize(widgetSize)),
        WidgetMode.Expanded => new Size(AppHost.Scale(384), AppHost.Scale(580)),
        _ => ScaleSquare(Appearance.BallDiameter(widgetSize))
    };

    private static Size ScaleSquare(int diameter)
    {
        var side = AppHost.Scale(diameter);
        return new Size(side, side);
    }

    private static Size ScaleSize(Size size) =>
        new(AppHost.Scale(size.Width), AppHost.Scale(size.Height));

    /// <summary>形态对应的圆角：-1 表示椭圆。</summary>
    private static int ModeRadius(WidgetMode mode) => mode switch
    {
        WidgetMode.Buddy => AppHost.Scale(28),
        WidgetMode.Custom => AppHost.Scale(28),
        WidgetMode.Expanded => AppHost.Scale(22),
        _ => -1
    };

    private void ApplyMode(WidgetMode mode)
    {
        Mode = mode;
        var size = CurrentSize(mode);

        // 先松开限制再改尺寸，否则从大形态缩到小形态时会被旧的 MinimumSize 挡住
        MinimumSize = Size.Empty;
        MaximumSize = Size.Empty;
        Size = size;
        MinimumSize = size;
        MaximumSize = size;
    }

    /// <summary>把窗口裁成当前形态对应的形状。区域要用窗口的真实物理像素。</summary>
    public void Reshape()
    {
        if (Handle == IntPtr.Zero) return;
        var size = new Size(Width, Height);
        NativeMethods.ApplyWindowShape(Handle, size, ModeRadius(Mode));
        Invalidate();
    }

    private static Point ClampToWorkArea(Point location, Size size)
    {
        var area = Screen.FromPoint(location).WorkingArea;
        var x = Math.Clamp(location.X, area.Left - size.Width / 3, area.Right - size.Width * 2 / 3);
        var y = Math.Clamp(location.Y, area.Top, area.Bottom - size.Height * 2 / 3);
        return new Point(x, y);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Reshape();
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        Reshape();
    }

    protected override void OnPageReady()
    {
        // 页面刚加载完时把自己的形态告诉界面，省得界面猜
        PostMessage(new { type = "widget-mode", mode = ModeName(Mode) });
    }
}
