using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;

// Windows fallback for Electron/libuv spawn UNKNOWN. No shell, elevation,
// command-string evaluation or credentials in arguments/output.
internal static class GameProcess {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo {
        public int cb; public string reserved, desktop, title;
        public int x, y, xSize, ySize, xCountChars, yCountChars, fillAttribute, flags;
        public short showWindow, reservedSize;
        public IntPtr reservedBytes, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory,
        ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    private static int Main(string[] args) {
        try {
            int port;
            IPAddress host;
            if (args.Length != 4 || !Directory.Exists(args[0]) ||
                (args[1] != "BubbleFighter.exe" && args[1] != "BubbleFighterU.exe") ||
                !IPAddress.TryParse(args[2], out host) || host.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork ||
                !Int32.TryParse(args[3], out port) || port < 1 || port > 65534) {
                Console.WriteLine("{\"error\":87}"); return 0;
            }
            Environment.SetEnvironmentVariable("__COMPAT_LAYER", "RunAsInvoker HighDpiAware");
            string root = Path.GetFullPath(args[0]);
            string executable = Path.Combine(root, args[1]);
            var command = new StringBuilder("\"" + executable + "\" --ip=" + host + " --port=" + port + " --areaid=1_1 --groupid=1");
            var start = new StartupInfo(); start.cb = Marshal.SizeOf(start);
            ProcessInfo child;
            // Detach with no inherited handles: the game must not hold the
            // helper's IPC output pipe open after the helper exits.
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x208,
                IntPtr.Zero, root, ref start, out child)) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                if (WaitForSingleObject(child.process, 1200) == 0) {
                    uint code; GetExitCodeProcess(child.process, out code);
                    Console.WriteLine("{\"exitCode\":" + code + "}");
                } else Console.WriteLine("{\"pid\":" + child.pid + "}");
            } finally {
                CloseHandle(child.thread); CloseHandle(child.process);
            }
        } catch (Win32Exception error) {
            Console.WriteLine("{\"error\":" + error.NativeErrorCode + "}");
        } catch {
            Console.WriteLine("{\"error\":0}");
        }
        return 0;
    }
}
