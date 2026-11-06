using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Tuijin;

public sealed class AppHost : ApplicationContext
{
    public const string ShowEventName = @"Local\Tuijin.ShowMain";
    private const int HotkeyId = 0x5455;
    private const int WmAppShowMain = 0x8001;

    private readonly EventWaitHandle _showEvent;
    private readonly AppMessageWindow _messages;
    private readonly System.Windows.Forms.Timer _boundsTimer;
    private readonly string[] _args;
    private RegisteredWaitHandle? _showWait;
    private Task<CoreWebView2Environment>? _environmentTask;
    private Task? _mainInitialization;
    private NotifyIcon? _tray;
    private ContextMenuStrip? _trayMenu;
    private bool _started;
    private bool _hideTipShown;
    private bool _disposed;

    public AppHost(EventWaitHandle showEvent, string[] args)
    {
        _showEvent = showEvent;
        _args = args;
        EnableDevTools = args.Contains("--devtools")
            || Environment.GetEnvironmentVariable("TUIJIN_DEVTOOLS") == "1";
        ForceMain = args.Contains("--main");

        AppIcon = LoadAppIcon();
        Store = new TaskStore(AppPaths.DataFile);
        Store.Changed += BroadcastState;

        _boundsTimer = new System.Windows.Forms.Timer { Interval = 350 };
        _boundsTimer.Tick += (_, _) => SaveBoundsNow();

        _messages = new AppMessageWindow();
        _messages.HotkeyPressed += ToggleWidget;
        _messages.ShowMainRequested += () => ShowMain();
        NativeMethods.RegisterHotKey(
            _messages.Handle,
            HotkeyId,
            NativeMethods.ModAlt | NativeMethods.ModShift,
            (uint)Keys.D);

        _showWait = ThreadPool.RegisterWaitForSingleObject(
            _showEvent,
            (_, timedOut) =>
            {
                if (!timedOut)
                {
                    NativeMethods.PostMessage(_messages.Handle, WmAppShowMain, IntPtr.Zero, IntPtr.Zero);
                }
            },
            null,
            Timeout.Infinite,
            false);

        CreateTray();
        Application.Idle += StartWhenIdle;
    }

    public TaskStore Store { get; }

    public Icon AppIcon { get; }

    public bool EnableDevTools { get; }

    public bool ForceMain { get; }

    public bool IsExiting { get; private set; }

    public MainForm? Main { get; private set; }

    public WidgetForm? Widget { get; private set; }

    public Color ThemeBackground => Store.Data.Settings.Theme == "dark"
        ? Color.FromArgb(23, 21, 18)
        : Color.FromArgb(243, 238, 229);

    /// <summary>
    /// 界面尺寸换算比例。
    /// 进程是 PerMonitorV2，GetDpiForSystem 返回的是当前显示器的实际 DPI。
    /// 注意别在窗口句柄刚建好时调 GetDpiForWindow——那时窗口还没落到显示器上，
    /// 会返回 96，把正确比例覆盖成 1.0，高 DPI 屏上所有窗口都会缩水 1/缩放 倍。
    /// </summary>
    public static double DpiScale
    {
        get
        {
            try
            {
                var dpi = NativeMethods.GetDpiForSystem();
                return dpi > 96 ? dpi / 96.0 : 1.0;
            }
            catch
            {
                return 1.0;
            }
        }
    }

    public static int Scale(int cssPixels) => (int)Math.Round(cssPixels * DpiScale);

    private void StartWhenIdle(object? sender, EventArgs e)
    {
        Application.Idle -= StartWhenIdle;
        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        if (_started) return;
        _started = true;
        try
        {
            await EnsureEnvironmentAsync();

            // 浮层是否出现完全听开关的。关掉时连 WebView2 都不创建，省一次初始化。
            if (Store.Data.Settings.WidgetVisible)
            {
                await ShowWidgetAsync(activate: false);
            }

            if (Store.Data.Settings.FirstRun || ForceMain)
            {
                await ShowMainAsync(null);
            }

            if (Store.Data.Settings.FirstRun)
            {
                Store.MarkStarted();
            }

            RefreshTrayMenu();
        }
        catch (Exception error)
        {
            Log.Write("STARTUP ERROR " + error);
            MessageBox.Show(
                "推进没有成功启动。\n\n" + error.Message,
                "推进",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            ExitApplication();
        }
    }

    private Task<CoreWebView2Environment> EnsureEnvironmentAsync()
    {
        return _environmentTask ??= CreateEnvironmentAsync();
    }

    private static async Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.WebViewDataDirectory);
        }
        catch (Exception error)
        {
            Log.Write("WEBVIEW DATA DIRECTORY ERROR " + error);
        }

        return await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: AppPaths.WebViewDataDirectory,
            options: new CoreWebView2EnvironmentOptions());
    }

    public void ShowMain(string? taskId = null)
    {
        _ = ShowMainAsync(taskId);
    }

    private async Task ShowMainAsync(string? taskId)
    {
        if (IsExiting) return;
        try
        {
            var environment = await EnsureEnvironmentAsync();
            if (Main is null)
            {
                Main = new MainForm(this)
                {
                    StartPosition = FormStartPosition.Manual
                };
                // Bounds 要在句柄建好之后再设：
                // 构造阶段设置会被 WinForms 的 DPI 自动缩放再压一遍，窗口会明显偏小。
                Main.SetInitialBounds(GetMainBounds().ToRectangle());
            }

            if (!string.IsNullOrWhiteSpace(taskId))
            {
                Main.PendingFocus = taskId;
            }

            Main.ShowAndActivate();

            if (!Main.WebReady)
            {
                _mainInitialization ??= Main.InitializeAsync(environment);
                await _mainInitialization;
            }

            if (!string.IsNullOrWhiteSpace(taskId))
            {
                Main.FlushFocus();
            }

            RefreshTrayMenu();
        }
        catch (Exception error)
        {
            Log.Write("SHOW MAIN ERROR " + error);
            MessageBox.Show(
                "工作台没有成功打开。\n\n" + error.Message,
                "推进",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    /// <summary>
    /// 「球的开关」的唯一入口：写设置并立即生效。
    /// 工作台外观面板、托盘菜单、Alt + Shift + D、浮层自己的「隐藏」都走这里，
    /// 所以开关状态和桌面上的实际表现永远一致，重启后也保留。
    /// </summary>
    public void SetWidgetVisible(bool visible)
    {
        // SetWidgetVisible 内部会触发 Changed → BroadcastState，界面上的开关自动跟上
        Store.SetWidgetVisible(visible);
        ApplyWidgetVisibility(visible, activate: visible);
        RefreshTrayMenu();
    }

    /// <summary>开关的落地：出现时按需创建窗口，关掉时只是收起来，不销毁。</summary>
    private void ApplyWidgetVisibility(bool visible, bool activate)
    {
        if (visible) ShowWidget(activate);
        else HideWidgetWindow();
    }

    /// <summary>
    /// 让浮层出现在桌面上。第一次调用时才创建窗口和 WebView2，
    /// 所以「启动时不显示球」不会白白初始化一份浏览器。
    /// </summary>
    public void ShowWidget(bool activate = true)
    {
        _ = ShowWidgetAsync(activate);
    }

    private async Task ShowWidgetAsync(bool activate)
    {
        if (IsExiting) return;
        try
        {
            var widget = await EnsureWidgetAsync();
            if (widget is null || IsExiting) return;

            // 展开态强制置顶，其余时候听用户的偏好
            widget.TopMost = _widgetExpanded || Store.Data.Settings.WidgetPinned;
            if (widget.WindowState == FormWindowState.Minimized)
            {
                widget.WindowState = FormWindowState.Normal;
            }
            widget.Show();
            if (activate)
            {
                widget.Activate();
                widget.BringToFront();
            }
            RefreshTrayMenu();
        }
        catch (Exception error)
        {
            Log.Write("SHOW WIDGET ERROR " + error);
            MessageBox.Show(
                "桌面浮球没有成功打开。\n\n" + error.Message,
                "推进",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private Task<WidgetForm?>? _widgetTask;

    private async Task<WidgetForm?> EnsureWidgetAsync()
    {
        if (Widget is not null && !Widget.IsDisposed) return Widget;

        // 缓存的任务只有在窗口还活着时才算数，否则会一直返回已销毁的窗体
        if (_widgetTask is not null)
        {
            var existing = _widgetTask.Status == TaskStatus.RanToCompletion
                ? _widgetTask.Result
                : await _widgetTask;
            if (existing is not null && !existing.IsDisposed) return existing;
            _widgetTask = null;
        }

        _widgetTask = CreateWidgetAsync();
        try
        {
            return await _widgetTask;
        }
        catch
        {
            // 创建失败就把任务清掉，下次点开关重新来过，而不是永远返回同一个异常
            _widgetTask = null;
            Widget = null;
            throw;
        }
    }

    private async Task<WidgetForm?> CreateWidgetAsync()
    {
        var environment = await EnsureEnvironmentAsync();
        var widget = new WidgetForm(this);
        widget.Bounds = GetWidgetBounds().ToRectangle();
        Widget = widget;
        widget.Show();
        widget.Reshape();
        await widget.InitializeAsync(environment);
        return widget;
    }

    /// <summary>隐藏浮层（并把开关关掉）。</summary>
    public void HideWidget()
    {
        SetWidgetVisible(false);
    }

    /// <summary>只把窗口收起来，不动设置。宿主自己临时用时才调。</summary>
    private void HideWidgetWindow()
    {
        if (Widget is null || Widget.IsDisposed) return;

        // 隐藏时顺手收回收起态，下次呼出是个干净的浮球
        if (_widgetExpanded)
        {
            _widgetExpanded = false;
            Widget.SetMode(CollapsedMode);
        }

        Widget.Hide();
        RefreshTrayMenu();
    }

    public void ToggleWidget()
    {
        // 以设置为准：不管窗口此刻因为什么不在，点一下就是「换一种状态」
        SetWidgetVisible(!Store.Data.Settings.WidgetVisible);
    }

    public void OnWindowMoved(WebWindow window)
    {
        _boundsTimer.Stop();
        _boundsTimer.Start();
    }

    public void OnWindowResized(WebWindow window)
    {
        // 工作台最大化 / 还原都不再动浮层：球和工作台现在是可以共存的，
        // 要不要显示球只由「球的开关」(settings.widgetVisible) 决定。
        _boundsTimer.Stop();
        _boundsTimer.Start();
    }

    public void OnWindowHidden(WebWindow window)
    {
        if (window == Main)
        {
            SaveBoundsNow();
            if (!_hideTipShown && _tray is not null)
            {
                _hideTipShown = true;
                try
                {
                    _tray.ShowBalloonTip(
                        3200,
                        "推进还在运行",
                        "工作台已收起到托盘。按 Alt + Shift + D 随时呼出桌面浮球。",
                        ToolTipIcon.Info);
                }
                catch
                {
                }
            }
        }
        else if (window == Widget)
        {
            // 用户从浮层自己的菜单里关掉它 = 关开关；否则会被设置立刻又拉出来
            Store.SetWidgetVisible(false);
            SaveBoundsNow();
        }

        RefreshTrayMenu();
    }

    private void SaveBoundsNow()
    {
        _boundsTimer.Stop();
        if (Main is not null && !Main.IsDisposed)
        {
            var bounds = Main.WindowState == FormWindowState.Maximized
                ? Main.RestoreBounds
                : Main.Bounds;
            if (bounds.Width >= 300 && bounds.Height >= 420)
            {
                Store.SetWindowBounds("mainBounds", bounds);
            }
        }
        if (Widget is not null && !Widget.IsDisposed)
        {
            // 只保存收起态的位置：展开态面板尺寸不一样，记下来会让下次启动的浮球跑偏
            if (!_widgetExpanded)
            {
                var bounds = Widget.Bounds;
                if (bounds.Width >= 60 && bounds.Height >= 60)
                {
                    Store.SetWindowBounds("widgetBounds", bounds);
                }
            }
        }
    }

    private BoundsInfo GetMainBounds()
    {
        var saved = Store.Data.Settings.MainBounds;
        if (saved is not null
            && IsOnScreen(saved)
            && saved.Width >= Scale(900)
            && saved.Height >= Scale(640))
        {
            var rectangle = saved.ToRectangle();
            return BoundsInfo.FromRectangle(ClampToScreen(rectangle));
        }
        return BoundsInfo.FromRectangle(DefaultMainBounds());
    }

    private BoundsInfo GetWidgetBounds()
    {
        var style = WidgetForm.ModeFromStyle(Store.Data.Settings.WidgetStyle);
        var size = WidgetForm.ModeSize(style, Store.Data.Settings.WidgetSize);
        var saved = Store.Data.Settings.WidgetBounds;
        if (saved is not null)
        {
            // 存的是球心位置，换尺寸后仍以同一点为中心
            var centerX = saved.X + saved.Width / 2;
            var centerY = saved.Y + saved.Height / 2;
            var rectangle = new Rectangle(centerX - size.Width / 2, centerY - size.Height / 2,
                size.Width, size.Height);
            if (IsOnScreen(BoundsInfo.FromRectangle(rectangle)))
            {
                return BoundsInfo.FromRectangle(ClampToScreen(rectangle));
            }
        }
        return BoundsInfo.FromRectangle(DefaultWidgetBounds(size));
    }

    private static Rectangle DefaultWidgetBounds(Size size)
    {
        // 和 DefaultMainBounds 同理：WorkingArea 是物理像素，常量是 DIP
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        var x = area.Right - size.Width - Scale(24);
        var y = area.Top + Math.Max(Scale(16), (area.Height - size.Height) / 2);
        return new Rectangle(x, y, size.Width, size.Height);
    }

    private static Rectangle DefaultWidgetBounds() =>
        DefaultWidgetBounds(WidgetForm.ModeSize(WidgetMode.Ball, "small"));

    /// <summary>托盘菜单切风格：写设置并立即换窗口形状。</summary>
    private void SwitchWidgetStyle(string style)    {
        var patch = JsonSerializer.SerializeToElement(new { widgetStyle = style });
        Store.UpdateSettings(patch);
        if (Widget is not null && !Widget.IsDisposed && !_widgetExpanded)
        {
            Widget.SetMode(CollapsedMode);
            Store.SetWindowBounds("widgetBounds", Widget.Bounds);
        }
        Main?.PostMessage(new { type = "state", state = Store.Snapshot() });
        Widget?.PostMessage(new { type = "state", state = Store.Snapshot() });
        RefreshTrayMenu();
    }

    /// <summary>托盘菜单里的「浮层大小」子项。</summary>
    private void AddSizeItem(ToolStripMenuItem parent, string size, string label)
    {
        var item = new ToolStripMenuItem(label)
        {
            Checked = Store.Data.Settings.WidgetSize == size,
            CheckOnClick = false
        };
        item.Click += (_, _) => SwitchWidgetSize(size);
        parent.DropDownItems.Add(item);
    }

    /// <summary>换浮层大小档位：保持中心点，重排窗口。</summary>
    private void SwitchWidgetSize(string size)
    {
        if (Store.Data.Settings.WidgetSize == size) return;
        Store.UpdateSettings(JsonSerializer.SerializeToElement(new { widgetSize = size }));
        if (Widget is not null && !Widget.IsDisposed && !_widgetExpanded)
        {
            Widget.ApplyWidgetSize();
            Store.SetWindowBounds("widgetBounds", Widget.Bounds);
        }
        Main?.PostMessage(new { type = "state", state = Store.Snapshot() });
        Widget?.PostMessage(new { type = "state", state = Store.Snapshot() });
        RefreshTrayMenu();
    }

    /// <summary>托盘菜单里的「回到屏幕右侧」：顺便把球打开，符合「我找不到它了」的实际意图。</summary>
    private async Task ResetWidgetPositionAsync()
    {
        try
        {
            var widget = await EnsureWidgetAsync();
            if (widget is null) return;
            var size = WidgetForm.ModeSize(
                WidgetForm.ModeFromStyle(Store.Data.Settings.WidgetStyle),
                Store.Data.Settings.WidgetSize);
            widget.Bounds = DefaultWidgetBounds(size);
            widget.Show();
            widget.Reshape();
            Store.SetWindowBounds("widgetBounds", widget.Bounds);
            Store.SetWidgetVisible(true);
            RefreshTrayMenu();
        }
        catch (Exception error)
        {
            Log.Write("RESET WIDGET POSITION ERROR " + error);
        }
    }

    /// <summary>
    /// 默认工作台尺寸。
    /// 注意 Screen.WorkingArea 在 DPI 感知进程里返回的是**物理像素**，
    /// 而这里的宽高常量是 DIP，所以屏幕尺寸要先除以缩放比，最后再整体乘回去。
    /// </summary>
    private static Rectangle DefaultMainBounds()
    {
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 800);
        var scale = DpiScale <= 0 ? 1.0 : DpiScale;

        // 换算成 DIP 再排版，避免和屏幕物理像素混着算
        var areaWidthDip = area.Width / scale;
        var areaHeightDip = area.Height / scale;

        var widthDip = Math.Min(1240.0, Math.Max(900.0, areaWidthDip - 472));
        var heightDip = Math.Min(820.0, Math.Max(640.0, areaHeightDip - 60));
        widthDip = Math.Min(widthDip, areaWidthDip - 48);

        var xDip = 24.0;
        if (xDip + widthDip + 424 > areaWidthDip)
        {
            xDip = Math.Max(0, areaWidthDip - widthDip - 24);
        }
        var yDip = Math.Max(16.0, (areaHeightDip - heightDip) / 2);

        return new Rectangle(
            area.Left + Scale((int)Math.Round(xDip)),
            area.Top + Scale((int)Math.Round(yDip)),
            Scale((int)Math.Round(widthDip)),
            Scale((int)Math.Round(heightDip)));
    }

    private static Rectangle ClampToScreen(Rectangle rectangle)
    {
        var area = Screen.FromRectangle(rectangle).WorkingArea;
        rectangle.Width = Math.Min(rectangle.Width, area.Width);
        rectangle.Height = Math.Min(rectangle.Height, area.Height);
        rectangle.X = Math.Clamp(rectangle.X, area.Left, area.Right - rectangle.Width);
        rectangle.Y = Math.Clamp(rectangle.Y, area.Top, area.Bottom - rectangle.Height);
        return rectangle;
    }

    private static bool IsOnScreen(BoundsInfo bounds)
    {
        var rectangle = bounds.ToRectangle();
        return Screen.AllScreens.Any(screen =>
        {
            var intersection = Rectangle.Intersect(screen.WorkingArea, rectangle);
            return intersection.Width > 120 && intersection.Height > 100;
        });
    }

    private Icon LoadAppIcon()
    {
        try
        {
            var path = AppPaths.Asset("icon.ico");
            if (File.Exists(path)) return new Icon(path);
        }
        catch (Exception error)
        {
            Log.Write("ICON LOAD ERROR " + error);
        }
        return SystemIcons.Application;
    }

    private void CreateTray()
    {
        _tray = new NotifyIcon
        {
            Icon = AppIcon,
            Text = "推进 · 桌面进度卡片",
            Visible = true
        };
        _tray.MouseClick += (_, eventArgs) =>
        {
            if (eventArgs.Button == MouseButtons.Left) ToggleWidget();
        };
        _tray.MouseDoubleClick += (_, eventArgs) =>
        {
            if (eventArgs.Button == MouseButtons.Left) ShowMain();
        };
        RefreshTrayMenu();
    }

    private void RefreshTrayMenu()
    {
        if (_tray is null) return;
        var menu = new ContextMenuStrip
        {
            ShowImageMargin = false,
            Font = new Font("Microsoft YaHei UI", 9f)
        };

        // 开关状态以设置为准，不看窗口此刻是否可见，避免和外观面板显示不一致
        var widgetOn = Store.Data.Settings.WidgetVisible;
        var toggleItem = new ToolStripMenuItem(widgetOn ? "隐藏桌面浮球" : "显示桌面浮球");
        toggleItem.Click += (_, _) => SetWidgetVisible(!Store.Data.Settings.WidgetVisible);
        menu.Items.Add(toggleItem);

        var mainItem = new ToolStripMenuItem("打开工作台");
        mainItem.Click += (_, _) => ShowMain();
        menu.Items.Add(mainItem);
        menu.Items.Add(new ToolStripSeparator());

        var styleMenu = new ToolStripMenuItem("桌面形态");
        var style = Store.Data.Settings.WidgetStyle;
        var ballItem = new ToolStripMenuItem("悬浮球")
        {
            Checked = style == "ball",
            CheckOnClick = false
        };
        ballItem.Click += (_, _) => SwitchWidgetStyle("ball");
        var buddyItem = new ToolStripMenuItem("卡通人")
        {
            Checked = style == "buddy",
            CheckOnClick = false
        };
        buddyItem.Click += (_, _) => SwitchWidgetStyle("buddy");
        var customItem = new ToolStripMenuItem("自己的图")
        {
            Checked = style == "custom",
            CheckOnClick = false
        };
        customItem.Click += (_, _) => SwitchWidgetStyle("custom");
        styleMenu.DropDownItems.Add(ballItem);
        styleMenu.DropDownItems.Add(buddyItem);
        styleMenu.DropDownItems.Add(customItem);
        menu.Items.Add(styleMenu);

        var sizeMenu = new ToolStripMenuItem("浮层大小");
        AddSizeItem(sizeMenu, "small", "小");
        AddSizeItem(sizeMenu, "medium", "中");
        AddSizeItem(sizeMenu, "large", "大");
        menu.Items.Add(sizeMenu);

        var pinItem = new ToolStripMenuItem("始终显示在其他窗口上方")
        {
            Checked = Store.Data.Settings.WidgetPinned,
            CheckOnClick = true
        };
        pinItem.Click += (_, _) =>
        {
            Store.SetWidgetPinned(!Store.Data.Settings.WidgetPinned);
            if (Widget is not null) Widget.TopMost = Store.Data.Settings.WidgetPinned;
            RefreshTrayMenu();
        };
        menu.Items.Add(pinItem);

        var resetItem = new ToolStripMenuItem("回到屏幕右侧");
        resetItem.Click += (_, _) => _ = ResetWidgetPositionAsync();
        menu.Items.Add(resetItem);

        var wallpaperItem = new ToolStripMenuItem("外观与壁纸…");
        wallpaperItem.Click += (_, _) => ShowMain();
        menu.Items.Add(wallpaperItem);
        menu.Items.Add(new ToolStripSeparator());

        var dataItem = new ToolStripMenuItem("打开数据文件夹");
        dataItem.Click += (_, _) => OpenDataFolder();
        menu.Items.Add(dataItem);

        menu.Items.Add(new ToolStripMenuItem("快捷键：Alt + Shift + D") { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());

        var exitItem = new ToolStripMenuItem("退出推进");
        exitItem.Click += (_, _) => ExitApplication();
        menu.Items.Add(exitItem);

        var previous = _trayMenu;
        _tray.ContextMenuStrip = menu;
        _trayMenu = menu;
        if (previous is not null && !previous.Visible) previous.Dispose();
    }

    private void OpenDataFolder()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.DataDirectory);
            Process.Start(new ProcessStartInfo
            {
                FileName = AppPaths.DataDirectory,
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            Log.Write("OPEN DATA FOLDER ERROR " + error);
        }
    }

    private void BroadcastState()
    {
        if (Main is not null) SendState(Main);
        if (Widget is not null) SendState(Widget);
    }

    public void SendState(WebWindow target)
    {
        var snapshot = Store.Snapshot();
        var json = JsonSerializer.Serialize(
            new { type = "state", state = snapshot },
            TaskStore.WireJson);
        target.PostJson(json);
    }

    public void HandleBridgeMessage(WebWindow source, string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (!root.TryGetProperty("type", out var typeElement)) return;
            var type = typeElement.GetString() ?? "";
            var id = root.TryGetProperty("id", out var idElement) && idElement.TryGetInt32(out var parsedId)
                ? parsedId
                : (int?)null;
            var payload = root.TryGetProperty("payload", out var payloadElement)
                ? payloadElement.Clone()
                : default;

            object? data = null;
            switch (type)
            {
                case "window:drag":
                    source.BeginDrag();
                    break;

                case "window:resize-start":
                    if (source is MainForm) source.BeginResize(GetInt(payload, "edge"));
                    data = new { };
                    break;

                case "window:resize-move":
                    if (source is MainForm)
                    {
                        source.ResizeBy(GetInt(payload, "dx"), GetInt(payload, "dy"));
                    }
                    data = new { };
                    break;

                case "window:resize-end":
                    if (source is MainForm) source.EndResize();
                    data = new { };
                    break;

                case "debug:log":
                    Log.Write("RENDERER " + GetOptionalString(payload, "message"));
                    break;

                case "app:get-state":
                {
                    var focusTaskId = Main?.PendingFocus;
                    if (Main is not null) Main.PendingFocus = null;
                    data = new
                    {
                        state = Store.Snapshot(),
                        focusTaskId,
                        info = new
                        {
                            version = typeof(AppHost).Assembly.GetName().Version?.ToString(3) ?? "1.0.0",
                            dataPath = AppPaths.DataFile,
                            // 界面用它渲染预设/强调色选项，避免两边各写一份硬编码
                            appearance = new
                            {
                                accents = Appearance.Accents,
                                presets = Appearance.Presets,
                                styles = Appearance.WidgetStyles,
                                minScale = Appearance.MinScale,
                                maxScale = Appearance.MaxScale
                            }
                        }
                    };
                    break;
                }

                case "task:create":
                {
                    var input = GetProperty(payload, "input");
                    var taskId = Store.CreateTask(input);
                    data = new { id = taskId, state = Store.Snapshot() };
                    break;
                }

                case "task:update":
                {
                    var taskId = RequireString(payload, "id");
                    Store.UpdateTask(taskId, GetProperty(payload, "patch"));
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "task:delete":
                {
                    Store.DeleteTask(RequireString(payload, "id"));
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "task:toggle-done":
                {
                    Store.ToggleTaskDone(RequireString(payload, "id"));
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "milestone:add":
                {
                    var taskId = RequireString(payload, "taskId");
                    Store.AddMilestone(taskId, GetProperty(payload, "input"));
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "milestone:update":
                {
                    var taskId = RequireString(payload, "taskId");
                    var milestoneId = RequireString(payload, "milestoneId");
                    Store.UpdateMilestone(taskId, milestoneId, GetProperty(payload, "patch"));
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "milestone:toggle":
                {
                    var taskId = RequireString(payload, "taskId");
                    var milestoneId = RequireString(payload, "milestoneId");
                    Store.ToggleMilestone(taskId, milestoneId);
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "milestone:delete":
                {
                    var taskId = RequireString(payload, "taskId");
                    var milestoneId = RequireString(payload, "milestoneId");
                    Store.DeleteMilestone(taskId, milestoneId);
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "settings:update":
                {
                    var beforeTheme = Store.Data.Settings.Theme;
                    var beforeStyle = Store.Data.Settings.WidgetStyle;
                    var beforeSize = Store.Data.Settings.WidgetSize;
                    var beforeVisible = Store.Data.Settings.WidgetVisible;
                    Store.UpdateSettings(GetProperty(payload, "patch"));
                    if (beforeTheme != Store.Data.Settings.Theme)
                    {
                        Main?.ApplyTheme();
                        Widget?.ApplyTheme();
                    }
                    if (Widget is not null && !Widget.IsDisposed)
                    {
                        Widget.TopMost = Store.Data.Settings.WidgetPinned;

                        // 桌面形态改了，收起态要跟着换窗口尺寸和形状
                        if (!_widgetExpanded && beforeStyle != Store.Data.Settings.WidgetStyle)
                        {
                            Widget.SetMode(CollapsedMode);
                            Store.SetWindowBounds("widgetBounds", Widget.Bounds);
                        }
                        // 只改大小档位：保持中心点重排
                        else if (!_widgetExpanded && beforeSize != Store.Data.Settings.WidgetSize)
                        {
                            Widget.ApplyWidgetSize();
                            Store.SetWindowBounds("widgetBounds", Widget.Bounds);
                        }
                    }
                    // 工作台外观面板里的「在桌面显示悬浮球」开关，落地成真正的显示 / 隐藏
                    if (beforeVisible != Store.Data.Settings.WidgetVisible)
                    {
                        ApplyWidgetVisibility(Store.Data.Settings.WidgetVisible, activate: false);
                    }
                    RefreshTrayMenu();
                    data = new { state = Store.Snapshot() };
                    break;
                }

                case "tasks:clear-completed":
                    Store.ClearCompleted();
                    data = new { state = Store.Snapshot() };
                    break;

                case "window:open-main":
                    ShowMain(GetOptionalString(payload, "taskId"));
                    data = new { };
                    break;

                case "window:open-widget":
                    // 工作台侧栏「放在桌面」是明确的「我要它出现」，所以顺带把开关打开
                    SetWidgetVisible(true);
                    data = new { };
                    break;

                case "widget:expand":
                    SetWidgetExpanded(true);
                    data = new { };
                    break;

                case "widget:collapse":
                    SetWidgetExpanded(false);
                    data = new { };
                    break;

                case "widget:drag-start":
                    BeginWidgetDrag();
                    data = new { };
                    break;

                case "widget:drag-move":
                    MoveWidgetBy(GetInt(payload, "dx"), GetInt(payload, "dy"));
                    data = new { };
                    break;

                case "widget:drag-end":
                    EndWidgetDrag();
                    data = new { };
                    break;

                case "wallpaper:pick":
                    data = new { file = PickWallpaper() };
                    break;

                case "wallpaper:clear":
                    ClearWallpaper();
                    data = new { };
                    break;

                case "widget-custom:pick":
                    data = new { file = PickWidgetCustom() };
                    break;

                case "widget-custom:clear":
                    ClearWidgetCustom();
                    data = new { };
                    break;

                case "window:hide-widget":
                    HideWidget();
                    data = new { };
                    break;

                case "window:toggle-widget":
                    ToggleWidget();
                    data = new { };
                    break;

                case "window:close-main":
                    Main?.Hide();
                    if (Main is not null) OnWindowHidden(Main);
                    data = new { };
                    break;

                case "window:minimize-main":
                    if (Main is not null) Main.WindowState = FormWindowState.Minimized;
                    data = new { };
                    break;

                case "window:toggle-maximize":
                    if (Main is not null)
                    {
                        Main.WindowState = Main.WindowState == FormWindowState.Maximized
                            ? FormWindowState.Normal
                            : FormWindowState.Maximized;
                        Main.PostMaximizedState();
                    }
                    data = new { };
                    break;

                case "app:open-data-folder":
                    OpenDataFolder();
                    data = new { };
                    break;

                default:
                    throw new StoreException("未知操作");
            }

            if (id is not null)
            {
                SendResponse(source, id.Value, true, data, null);
            }
        }
        catch (Exception error)
        {
            Log.Write("BRIDGE ERROR " + error);
            try
            {
                using var document = JsonDocument.Parse(json);
                if (document.RootElement.TryGetProperty("id", out var idElement)
                    && idElement.TryGetInt32(out var id))
                {
                    SendResponse(source, id, false, null, error.Message);
                }
            }
            catch
            {
            }
        }
    }

    private static void SendResponse(WebWindow source, int id, bool ok, object? data, string? error)
    {
        var json = JsonSerializer.Serialize(
            new { type = "response", id, ok, data, error },
            TaskStore.WireJson);
        source.PostJson(json);
    }

    private static JsonElement GetProperty(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value))
        {
            return value;
        }
        return default;
    }

    private static string RequireString(JsonElement element, string name)
    {
        var value = GetOptionalString(element, name);
        if (string.IsNullOrWhiteSpace(value)) throw new StoreException("参数不完整");
        return value;
    }

    private static string? GetOptionalString(JsonElement element, string name)
    {
        var value = GetProperty(element, name);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static int GetInt(JsonElement element, string name)
    {
        var value = GetProperty(element, name);
        if (value.ValueKind != JsonValueKind.Number) return 0;
        return value.TryGetDouble(out var number)
            ? (int)Math.Round(number)
            : 0;
    }

    // ---------------- 桌面浮层：形态与拖动 ----------------

    private bool _widgetExpanded;
    private Rectangle _dragBaseBounds;

    private WidgetMode CollapsedMode => WidgetForm.ModeFromStyle(Store.Data.Settings.WidgetStyle);

    private void SetWidgetExpanded(bool expanded)
    {
        if (Widget is null || Widget.IsDisposed) return;
        if (_widgetExpanded == expanded) return;
        _widgetExpanded = expanded;

        if (expanded)
        {
            // 展开时贴着原来的位置，但保证整块面板在屏幕内
            Widget.SetMode(WidgetMode.Expanded);
            Widget.Bounds = ClampWidgetBounds(Widget.Bounds);
            // 展开是要操作的，被别的窗口挡住最恼人，这时强制浮到最前
            Widget.TopMost = true;
            ShowWidget(activate: true);
        }
        else
        {
            Widget.SetMode(CollapsedMode);
            // 收回后恢复用户自己设的置顶偏好
            Widget.TopMost = Store.Data.Settings.WidgetPinned;
            Store.SetWindowBounds("widgetBounds", Widget.Bounds);
        }

        RefreshTrayMenu();
    }

    private static Rectangle ClampWidgetBounds(Rectangle rectangle)
    {
        var area = Screen.FromRectangle(rectangle).WorkingArea;
        var x = Math.Clamp(rectangle.X, area.Left, Math.Max(area.Left, area.Right - rectangle.Width));
        var y = Math.Clamp(rectangle.Y, area.Top, Math.Max(area.Top, area.Bottom - rectangle.Height));
        return new Rectangle(x, y, rectangle.Width, rectangle.Height);
    }

    private void BeginWidgetDrag()
    {
        if (Widget is null || Widget.IsDisposed) return;
        _dragBaseBounds = Widget.Bounds;
    }

    private void MoveWidgetBy(int dx, int dy)
    {
        if (Widget is null || Widget.IsDisposed) return;
        if (dx == 0 && dy == 0) return;

        // 界面给的是相对上一次的增量，累在上一帧的实际位置上，
        // 这样被屏幕边缘夹住之后不会和真实位置脱节。
        _dragBaseBounds = new Rectangle(
            _dragBaseBounds.X + dx,
            _dragBaseBounds.Y + dy,
            _dragBaseBounds.Width,
            _dragBaseBounds.Height);

        var area = Screen.FromRectangle(_dragBaseBounds).WorkingArea;
        var x = Math.Clamp(_dragBaseBounds.X,
            area.Left - _dragBaseBounds.Width / 2,
            area.Right - _dragBaseBounds.Width / 2);
        var y = Math.Clamp(_dragBaseBounds.Y,
            area.Top,
            area.Bottom - _dragBaseBounds.Height / 2);

        Widget.Location = new Point(x, y);

        // 以夹取后的真实位置作为下一帧基准
        _dragBaseBounds = Widget.Bounds;
    }

    private void EndWidgetDrag()
    {
        if (Widget is null || Widget.IsDisposed) return;
        Store.SetWindowBounds("widgetBounds", Widget.Bounds);
    }

    // ---------------- 壁纸 ----------------

    private string? PickWallpaper()
    {
        try
        {
            using var dialog = new OpenFileDialog
            {
                Title = "选一张图片做壁纸",
                Filter = "图片文件|*.jpg;*.jpeg;*.png;*.bmp;*.webp;*.gif|所有文件|*.*",
                CheckFileExists = true
            };

            if (dialog.ShowDialog() != DialogResult.OK) return null;

            Directory.CreateDirectory(AppPaths.WallpaperDirectory);
            var fileName = $"wall-{DateTimeOffset.Now:yyyyMMddHHmmss}.jpg";
            var target = Path.Combine(AppPaths.WallpaperDirectory, fileName);

            using var source = Image.FromFile(dialog.FileName);
            SaveWallpaper(source, target);

            // 旧的壁纸文件就不留了，只保留最近一张
            foreach (var existing in Directory.GetFiles(AppPaths.WallpaperDirectory, "wall-*.jpg"))
            {
                if (!string.Equals(existing, target, StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Delete(existing); } catch { }
                }
            }

            return fileName;
        }
        catch (Exception error)
        {
            Log.Write("PICK WALLPAPER ERROR " + error);
            return null;
        }
    }

    /// <summary>缩放并压缩到最长边不超过 2560，避免几 MB 的原图拖慢渲染。</summary>
    private static void SaveWallpaper(Image source, string target)
    {
        const int maxSide = 2560;
        var scale = Math.Min(1.0, (double)maxSide / Math.Max(source.Width, source.Height));
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));

        using var bitmap = new Bitmap(width, height);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            graphics.DrawImage(source, 0, 0, width, height);
        }

        var encoder = ImageCodecInfo.GetImageEncoders()
            .FirstOrDefault(info => info.FormatID == System.Drawing.Imaging.ImageFormat.Jpeg.Guid);

        if (encoder is null)
        {
            bitmap.Save(target, System.Drawing.Imaging.ImageFormat.Jpeg);
            return;
        }

        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 88L);
        bitmap.Save(target, encoder, parameters);
    }

    private void ClearWallpaper()
    {
        try
        {
            if (Directory.Exists(AppPaths.WallpaperDirectory))
            {
                foreach (var file in Directory.GetFiles(AppPaths.WallpaperDirectory, "wall-*"))
                {
                    try { File.Delete(file); } catch { }
                }
            }
            if (Store.Data.Settings.Wallpaper.Kind == "image")
            {
                Store.UpdateSettings(JsonSerializer.SerializeToElement(new
                {
                    wallpaper = new { kind = "none", file = (string?)null }
                }));
                BroadcastState();
            }
        }
        catch (Exception error)
        {
            Log.Write("CLEAR WALLPAPER ERROR " + error);
        }
    }

    // ---------------- 桌面浮层的自定义图片 ----------------

    /// <summary>
    /// 选一张图给桌面浮层。存盘逻辑和壁纸一样：压缩成 JPEG，只留最近一张。
    /// 取消或出错返回 null，界面据此保持原样。
    /// </summary>
    private string? PickWidgetCustom()
    {
        try
        {
            using var dialog = new OpenFileDialog
            {
                Title = "选一张图做桌面小人",
                Filter = "图片文件|*.jpg;*.jpeg;*.png;*.bmp;*.webp;*.gif|所有文件|*.*",
                CheckFileExists = true
            };

            if (dialog.ShowDialog() != DialogResult.OK) return null;

            Directory.CreateDirectory(AppPaths.WidgetCustomDirectory);
            var fileName = $"widget-{DateTimeOffset.Now:yyyyMMddHHmmss}.jpg";
            var target = Path.Combine(AppPaths.WidgetCustomDirectory, fileName);

            using var source = Image.FromFile(dialog.FileName);
            SaveWallpaper(source, target);

            // 旧的图不留，只保留最近一张
            foreach (var existing in Directory.GetFiles(AppPaths.WidgetCustomDirectory, "widget-*"))
            {
                if (!string.Equals(existing, target, StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Delete(existing); } catch { }
                }
            }

            return fileName;
        }
        catch (Exception error)
        {
            Log.Write("PICK WIDGET CUSTOM ERROR " + error);
            return null;
        }
    }

    /// <summary>删掉浮层的自定义图片，并把设置里的文件名置空（界面会回落成卡通人）。</summary>
    private void ClearWidgetCustom()
    {
        try
        {
            if (Directory.Exists(AppPaths.WidgetCustomDirectory))
            {
                foreach (var file in Directory.GetFiles(AppPaths.WidgetCustomDirectory, "widget-*"))
                {
                    try { File.Delete(file); } catch { }
                }
            }
            if (!string.IsNullOrWhiteSpace(Store.Data.Settings.WidgetCustom.File))
            {
                Store.UpdateSettings(JsonSerializer.SerializeToElement(new
                {
                    widgetCustom = new { file = (string?)null }
                }));
                BroadcastState();
            }
        }
        catch (Exception error)
        {
            Log.Write("CLEAR WIDGET CUSTOM ERROR " + error);
        }
    }

    public void ExitApplication()
    {
        if (IsExiting) return;
        IsExiting = true;
        SaveBoundsNow();
        Store.Flush();

        _boundsTimer.Stop();
        _boundsTimer.Dispose();

        try
        {
            NativeMethods.UnregisterHotKey(_messages.Handle, HotkeyId);
        }
        catch
        {
        }

        _showWait?.Unregister(null);
        _showWait = null;
        _messages.Dispose();

        if (_tray is not null)
        {
            _tray.Visible = false;
            _tray.Dispose();
            _tray = null;
        }
        _trayMenu?.Dispose();
        _trayMenu = null;

        Main?.Close();
        Widget?.Close();
        Main = null;
        Widget = null;

        if (!ReferenceEquals(AppIcon, SystemIcons.Application))
        {
            AppIcon.Dispose();
        }

        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            _showWait?.Unregister(null);
            _showWait = null;
            _messages.Dispose();
            _tray?.Dispose();
            _trayMenu?.Dispose();
            _boundsTimer.Dispose();
            _showEvent.Dispose();
        }
        base.Dispose(disposing);
    }

    private sealed class AppMessageWindow : NativeWindow, IDisposable
    {
        public AppMessageWindow()
        {
            CreateHandle(new CreateParams { Caption = "Tuijin.AppMessageWindow" });
        }

        public event Action? HotkeyPressed;

        public event Action? ShowMainRequested;

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == NativeMethods.WmHotKey)
            {
                HotkeyPressed?.Invoke();
                return;
            }
            if (message.Msg == WmAppShowMain)
            {
                ShowMainRequested?.Invoke();
                return;
            }
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            DestroyHandle();
        }
    }
}
