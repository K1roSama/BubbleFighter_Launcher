using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.ComponentModel;

internal static class LauncherEntry {
    [STAThread]
    private static void Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string executable = Path.Combine(root, "launcher", "dist", "BubbleFighterLauncher-win32-x64", "BubbleFighterLauncher.exe");
        try {
            if (!File.Exists(executable)) throw new FileNotFoundException();
            var start = new ProcessStartInfo {
                FileName = executable,
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(start);
        } catch (Exception error) {
            string message = "启动器无法打开，请检查程序文件是否完整，并重新启动。";
            if (error is FileNotFoundException || error is DirectoryNotFoundException)
                message = "找不到启动器文件。请将 GameLauncher.exe 和完整的 launcher 文件夹放在游戏根目录中。";
            else if (error is UnauthorizedAccessException)
                message = "无法访问启动器文件，请检查文件权限。";
            else if (error is Win32Exception) {
                int code = ((Win32Exception)error).NativeErrorCode;
                if (code == 5 || code == 740) message = "系统拒绝启动程序，请检查启动器的文件权限和兼容性设置。";
                else if (code == 193 || code == 216) message = "启动器文件损坏或与当前 Windows 系统不兼容，请重新解压完整安装包。";
                else message = "Windows 无法打开启动器（系统错误码：" + code + "）。请检查程序文件。";
            }
            MessageBox.Show(message, "泡泡战士启动器", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
