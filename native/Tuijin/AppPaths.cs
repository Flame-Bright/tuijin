using System.Drawing;
using System.Runtime.InteropServices;

namespace Tuijin;

public static class AppPaths
{
    private static readonly Lazy<string> DataRoot = new(() => ResolveRoot(roaming: true));
    private static readonly Lazy<string> CacheRoot = new(() => ResolveRoot(roaming: false));

    public static string AppDirectory => AppContext.BaseDirectory;
    public static string RendererDirectory => Path.Combine(AppDirectory, "renderer");
    public static string DataDirectory => DataRoot.Value;
    public static string DataFile => Path.Combine(DataDirectory, "data.json");
    public static string WallpaperDirectory => Path.Combine(DataDirectory, "wallpaper");
    public static string WidgetCustomDirectory => Path.Combine(DataDirectory, "widget-custom");
    public static string WebViewDataDirectory => Path.Combine(CacheRoot.Value, "WebView2");

    public static string Asset(string name) => Path.Combine(AppDirectory, "assets", name);

    /// <summary>
    /// 正常的用户目录优先；如果那个位置不可写（例如程序被放在受限制的目录里运行，
    /// 进程完整性级别较低，写不进 %APPDATA%），就退回程序自己旁边的 userdata 目录，
    /// 这样程序在任何位置都能启动，而不是直接报错退出。
    /// </summary>
    private static string ResolveRoot(bool roaming)
    {
        var preferred = Path.Combine(
            Environment.GetFolderPath(roaming
                ? Environment.SpecialFolder.ApplicationData
                : Environment.SpecialFolder.LocalApplicationData),
            "Tuijin");

        if (IsWritable(preferred)) return preferred;

        var fallback = Path.Combine(AppDirectory, "userdata", roaming ? "roaming" : "local");
        if (IsWritable(fallback)) return fallback;

        return preferred;
    }

    private static bool IsWritable(string directory)
    {
        try
        {
            Directory.CreateDirectory(directory);
            var probe = Path.Combine(directory, ".write-test");
            File.WriteAllText(probe, string.Empty);
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }
}

public static class Log
{
    private static readonly object Gate = new();

    public static void Write(string message)
    {
        var line = $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}";
        try
        {
            Directory.CreateDirectory(AppPaths.DataDirectory);
            lock (Gate)
            {
                File.AppendAllText(Path.Combine(AppPaths.DataDirectory, "app.log"), line);
            }
        }
        catch
        {
        }
    }
}

internal static class NativeMethods
{
    public const int WmHotKey = 0x0312;
    public const int WmNcLButtonDown = 0x00A1;
    public const int WmNcHitTest = 0x0084;
    public const int HtCaption = 0x0002;
    public const uint ModAlt = 0x0001;
    public const uint ModShift = 0x0004;

    // WM_NCHITTEST 返回值
    public const int HtClient = 1;
    public const int HtLeft = 10;
    public const int HtRight = 11;
    public const int HtTop = 12;
    public const int HtTopLeft = 13;
    public const int HtTopRight = 14;
    public const int HtBottom = 15;
    public const int HtBottomLeft = 16;
    public const int HtBottomRight = 17;

    [DllImport("user32.dll")]
    public static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForSystem();

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hwnd);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern IntPtr CreateEllipticRgn(int left, int top, int right, int bottom);

    [DllImport("gdi32.dll")]
    public static extern bool DeleteObject(IntPtr handle);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);

    /// <summary>
    /// 把窗口裁成指定形状。半径取负值表示椭圆，0 表示直角矩形。
    /// 返回的 region 交给系统托管，调用方不要 DeleteObject。
    /// </summary>
    public static void ApplyWindowShape(IntPtr handle, Size size, int radius)
    {
        if (handle == IntPtr.Zero || size.Width <= 0 || size.Height <= 0) return;

        IntPtr region;
        if (radius < 0)
        {
            region = CreateEllipticRgn(0, 0, size.Width, size.Height);
        }
        else if (radius == 0)
        {
            region = CreateRoundRectRgn(0, 0, size.Width + 1, size.Height + 1, 0, 0);
        }
        else
        {
            region = CreateRoundRectRgn(0, 0, size.Width + 1, size.Height + 1, radius * 2, radius * 2);
        }

        if (region == IntPtr.Zero) return;
        if (SetWindowRgn(handle, region, true) == 0)
        {
            DeleteObject(region);
        }
    }

    /// <summary>恢复成完整矩形窗口。</summary>
    public static void ClearWindowShape(IntPtr handle)
    {
        if (handle == IntPtr.Zero) return;
        SetWindowRgn(handle, IntPtr.Zero, true);
    }

    public static void SetRoundedCorners(IntPtr handle, bool rounded)
    {
        try
        {
            // DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2, DWMWCP_DONOTROUND = 1
            var preference = rounded ? 2 : 1;
            DwmSetWindowAttribute(handle, 33, ref preference, sizeof(int));
        }
        catch
        {
        }
    }

    public static void StartWindowDrag(IntPtr handle)
    {
        ReleaseCapture();
        SendMessage(handle, WmNcLButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
    }
}
