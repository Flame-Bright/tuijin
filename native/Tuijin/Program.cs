using System.Runtime.InteropServices;

namespace Tuijin;

internal static class Program
{
    private const string MutexName = @"Local\Tuijin.Desktop.SingleInstance";

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            SetCurrentProcessExplicitAppUserModelID("com.liuchengming.tuijin");
        }
        catch
        {
        }

        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, eventArgs) =>
        {
            Log.Write("THREAD EXCEPTION " + eventArgs.Exception);
            MessageBox.Show(
                "推进遇到了一点问题。\n\n" + eventArgs.Exception.Message,
                "推进",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
            Log.Write("UNHANDLED EXCEPTION " + eventArgs.ExceptionObject);

        var created = false;
        using var mutex = new Mutex(true, MutexName, out created);
        if (!created)
        {
            SignalExistingInstance();
            return;
        }

        using var showEvent = new EventWaitHandle(
            false,
            EventResetMode.AutoReset,
            AppHost.ShowEventName);

        using var host = new AppHost(showEvent, args);
        Application.Run(host);

        try
        {
            mutex.ReleaseMutex();
        }
        catch
        {
        }
    }

    private static void SignalExistingInstance()
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                using var showEvent = EventWaitHandle.OpenExisting(AppHost.ShowEventName);
                showEvent.Set();
                return;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                Thread.Sleep(80);
            }
            catch
            {
                return;
            }
        }
    }
}
