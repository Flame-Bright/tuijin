using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Tuijin;

public abstract class WebWindow : Form
{
    private readonly WebView2 _webView = new();

    protected WebWindow(AppHost host)
    {
        Host = host;
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        BackColor = host.ThemeBackground;
        DoubleBuffered = true;
        Icon = host.AppIcon;
        ShowInTaskbar = false;

        _webView.Dock = DockStyle.Fill;
        _webView.DefaultBackgroundColor = host.ThemeBackground;
        _webView.Margin = Padding.Empty;
        Controls.Add(_webView);
    }

    protected AppHost Host { get; }

    public bool WebReady { get; private set; }

    public WebView2 WebView => _webView;

    public abstract string PageName { get; }

    protected virtual bool ToolWindow => false;

    /// <summary>
    /// 桌面浮层用 SetWindowRgn 自己裁形状，再交给 DWM 圆角会互相打架。
    /// </summary>
    protected virtual bool UseRoundedCorners => true;

    /// <summary>
    /// 无边框窗口默认不能拖动边缘缩放。
    /// 打开后渲染层会在边缘画热区，用 resize:* 命令驱动宿主改窗口尺寸。
    /// </summary>
    protected virtual bool UseResizeBorder => false;

    /// <summary>边缘热区宽度（DIP），比系统默认略宽，抓起来更顺手。</summary>
    protected virtual int ResizeBorderWidth => 8;

    public async Task InitializeAsync(CoreWebView2Environment environment)
    {
        Directory.CreateDirectory(AppPaths.WebViewDataDirectory);
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = Host.EnableDevTools;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsWebMessageEnabled = true;

        core.WebMessageReceived += (_, eventArgs) => Host.HandleBridgeMessage(this, eventArgs.WebMessageAsJson);
        core.NavigationCompleted += (_, eventArgs) =>
        {
            if (!eventArgs.IsSuccess)
            {
                Log.Write($"NAVIGATION FAILED {PageName}: {eventArgs.WebErrorStatus}");
                return;
            }
            WebReady = true;
            Host.SendState(this);
            OnPageReady();
        };
        core.NewWindowRequested += (_, eventArgs) => eventArgs.Handled = true;
        core.PermissionRequested += (_, eventArgs) =>
        {
            eventArgs.State = CoreWebView2PermissionState.Deny;
            eventArgs.Handled = true;
        };
        core.ProcessFailed += (_, eventArgs) => Log.Write($"WEBVIEW PROCESS FAILED {PageName}: {eventArgs.ProcessFailedKind}");

        core.SetVirtualHostNameToFolderMapping(
            "tuijin.local",
            AppPaths.RendererDirectory,
            CoreWebView2HostResourceAccessKind.Allow);

        // 自定义壁纸走独立虚拟主机，避免和界面资源混在一起
        var wallpaperDirectory = AppPaths.WallpaperDirectory;
        try
        {
            Directory.CreateDirectory(wallpaperDirectory);
        }
        catch (Exception error)
        {
            Log.Write("WALLPAPER DIRECTORY ERROR " + error);
        }
        core.SetVirtualHostNameToFolderMapping(
            "tuijin.wall",
            wallpaperDirectory,
            CoreWebView2HostResourceAccessKind.Allow);

        // 浮层的自定义图片走另一个独立虚拟主机，和壁纸分开，避免同名文件互相干扰
        var widgetCustomDirectory = AppPaths.WidgetCustomDirectory;
        try
        {
            Directory.CreateDirectory(widgetCustomDirectory);
        }
        catch (Exception error)
        {
            Log.Write("WIDGET CUSTOM DIRECTORY ERROR " + error);
        }
        core.SetVirtualHostNameToFolderMapping(
            "tuijin.widget",
            widgetCustomDirectory,
            CoreWebView2HostResourceAccessKind.Allow);

        core.Navigate($"https://tuijin.local/{PageName}");
    }

    protected virtual void OnPageReady()
    {
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var parameters = base.CreateParams;
            if (ToolWindow) parameters.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
            parameters.ClassStyle |= 0x00020000; // CS_DROPSHADOW
            return parameters;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (UseRoundedCorners) NativeMethods.SetRoundedCorners(Handle, true);
    }

    /// <summary>
    /// 无边框窗口的边缘缩放由渲染层发起（WebView2 会吃掉原生边缘消息），
    /// 这里提供宿主侧的落地：记录起点、按边应用位移。
    /// </summary>
    public void BeginResize(int edge)
    {
        _resizeEdge = edge;
        _resizeStartBounds = Bounds;
        NativeMethods.GetCursorPos(out var point);
        _resizeStartCursor = new Point(point.X, point.Y);
    }

    public void ResizeBy(int dx, int dy)
    {
        if (_resizeEdge == 0) return;
        if (dx == 0 && dy == 0) return;

        // 界面给的是相对上一帧的增量，累加在上一帧的位置上
        _resizeStartBounds = ResizeRect(_resizeStartBounds, dx, dy);
        var rect = _resizeStartBounds;

        var minWidth = Math.Max(360, MinimumSize.Width);
        var minHeight = Math.Max(320, MinimumSize.Height);

        if (rect.Width < minWidth)
        {
            if (_resizeEdge is NativeMethods.HtLeft or NativeMethods.HtTopLeft or NativeMethods.HtBottomLeft)
            {
                rect.X = rect.Right - minWidth;
            }
            rect.Width = minWidth;
        }
        if (rect.Height < minHeight)
        {
            if (_resizeEdge is NativeMethods.HtTop or NativeMethods.HtTopLeft or NativeMethods.HtTopRight)
            {
                rect.Y = rect.Bottom - minHeight;
            }
            rect.Height = minHeight;
        }

        Bounds = rect;
        // 夹取后的实际位置作为下一帧基准
        _resizeStartBounds = Bounds;
    }

    private Rectangle ResizeRect(Rectangle rect, int dx, int dy)
    {
        switch (_resizeEdge)
        {
            case NativeMethods.HtLeft:
                rect.X += dx;
                rect.Width -= dx;
                break;
            case NativeMethods.HtRight:
                rect.Width += dx;
                break;
            case NativeMethods.HtTop:
                rect.Y += dy;
                rect.Height -= dy;
                break;
            case NativeMethods.HtBottom:
                rect.Height += dy;
                break;
            case NativeMethods.HtTopLeft:
                rect.X += dx;
                rect.Y += dy;
                rect.Width -= dx;
                rect.Height -= dy;
                break;
            case NativeMethods.HtTopRight:
                rect.Y += dy;
                rect.Width += dx;
                rect.Height -= dy;
                break;
            case NativeMethods.HtBottomLeft:
                rect.X += dx;
                rect.Width -= dx;
                rect.Height += dy;
                break;
            case NativeMethods.HtBottomRight:
                rect.Width += dx;
                rect.Height += dy;
                break;
        }
        return rect;
    }

    public void EndResize()
    {
        _resizeEdge = 0;
        Host.OnWindowResized(this);
    }

    private int _resizeEdge;
    private Rectangle _resizeStartBounds;
    private Point _resizeStartCursor;

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (Handle != IntPtr.Zero && UseRoundedCorners)
        {
            NativeMethods.SetRoundedCorners(Handle, WindowState != FormWindowState.Maximized);
        }
        Host.OnWindowResized(this);
        PostMaximizedState();
    }

    protected override void OnMove(EventArgs e)
    {
        base.OnMove(e);
        Host.OnWindowMoved(this);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!Host.IsExiting && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            Host.OnWindowHidden(this);
        }
        base.OnFormClosing(e);
    }

    public bool PostJson(string json)
    {
        if (!WebReady || _webView.CoreWebView2 is null) return false;
        try
        {
            _webView.CoreWebView2.PostWebMessageAsJson(json);
            return true;
        }
        catch (Exception error)
        {
            Log.Write("POST MESSAGE ERROR " + error);
            return false;
        }
    }

    public bool PostMessage(object payload)
    {
        return PostJson(JsonSerializer.Serialize(payload, TaskStore.WireJson));
    }

    public void PostMaximizedState()
    {
        if (!WebReady) return;
        PostMessage(new { type = "maximized", value = WindowState == FormWindowState.Maximized });
    }

    public void BeginDrag()
    {
        if (WindowState == FormWindowState.Maximized) return;
        NativeMethods.StartWindowDrag(Handle);
    }

    public void ApplyTheme()
    {
        BackColor = Host.ThemeBackground;
        try
        {
            _webView.DefaultBackgroundColor = Host.ThemeBackground;
        }
        catch
        {
        }
    }
}
