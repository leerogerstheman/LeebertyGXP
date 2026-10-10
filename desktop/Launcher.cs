using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

/*
 * LeebertyGXP - desktop launcher.
 *
 * WHY THIS IS C# AND NOT ELECTRON
 * -------------------------------
 * The application deliberately has a minimal third-party footprint: in a
 * validated environment every component needs its own supplier assessment
 * (EU GMP Annex 11 §7.1). Wrapping it in Electron would import hundreds of
 * packages purely to obtain a window.
 *
 * The main window is OUR window - a WinForms frame with the LeebertyGXP title
 * and icon - whose content is rendered by an embedded WebView2 control using
 * Microsoft's WebView2 SDK bindings (Microsoft.Web.WebView2.Core.dll +
 * WebView2Loader.dll, the same component the OS ships with Edge). The browser
 * is not opened; the engine is hosted inside our own window, which is how
 * native desktop clients render web content without a browser chrome.
 *
 * WHAT IT DOES
 *   1. Reuses an already-running instance if the health endpoint answers.
 *   2. Otherwise starts `node src/server.js` hidden, and waits for health.
 *   3. Opens the workbench in a NATIVE window (our title, our icon) hosting an
 *      embedded WebView2 control. `--browser` forces the legacy Edge app-mode
 *      window instead; that mode also remains the fallback if the WebView2 SDK
 *      files or runtime are missing.
 *   4. Sits in the notification area with a menu: open, open in browser,
 *      generate demo data, verify the audit trail, back up, stop, exit.
 *
 * The tray menu matters for the workflow story: the background monitor runs as a
 * child of the server, so "stop" has to stop both, and a user needs one place to
 * do that without hunting for a console window.
 */
static class Program
{
    const string AppName = "LeebertyGXP";

    static NotifyIcon tray;
    static Process serverProcess;
    static string port = "8788";
    static string root;
    static string nodeExe;
    static string edgeExe;
    static bool weStartedServer;

    /// <summary>
    /// Locate the directory that contains src\server.js.
    ///
    /// The launcher is built into dist\desktop\ but is meant to be used from the
    /// project root, so taking the executable's own directory as the root made the
    /// build output unable to verify itself - and would break for anyone who ran
    /// the exe from the build folder. Search order: the executable's directory,
    /// then the current working directory, then up to four parent levels of each.
    /// An explicit --root still wins (applied by the caller after this returns).
    /// </summary>
    static string ResolveRoot()
    {
        string[] starts = new string[]
        {
            AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'),
            Directory.GetCurrentDirectory().TrimEnd('\\')
        };

        foreach (string start in starts)
        {
            string dir = start;
            for (int depth = 0; depth < 5 && dir != null; depth++)
            {
                if (File.Exists(Path.Combine(dir, "src", "server.js"))) return dir;
                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
        }

        // Nothing found: report the executable's directory, which is what the
        // self-test and the error message should name.
        return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    }

    [STAThread]
    static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        root = ResolveRoot();
        bool selfTest = false;
        bool browserMode = false;
        string capturePath = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--port" && i + 1 < args.Length) port = args[i + 1];
            else if (args[i] == "--root" && i + 1 < args.Length) root = args[i + 1];
            else if (args[i] == "--selftest") selfTest = true;
            else if (args[i] == "--browser") browserMode = true;
            else if (args[i] == "--capture" && i + 1 < args.Length) capturePath = args[i + 1];
            else if (args[i] == "--theme" && i + 1 < args.Length) WindowTheme.Requested = WindowTheme.Normalize(args[i + 1]);
            else if (args[i] == "--custom-titlebar") WindowTheme.CustomTitleBar = true;
        }

        nodeExe = FindNode();
        edgeExe = FindEdge();

        // Headless verification path: exercises discovery and process management
        // without putting a window or a tray icon on screen, so the build script
        // can prove the launcher works on the machine that produced it.
        if (selfTest) { RunSelfTest(); return; }

        if (nodeExe == null)
        {
            MessageBox.Show(
                "未找到 Node.js。\r\n\r\n本工作台需要 Node.js 22.5 或更高版本。\r\n请从 https://nodejs.org 安装后重试。\r\n\r\n" +
                "Node.js was not found. This workbench requires Node.js 22.5 or newer.\r\n" +
                "Install the LTS build from https://nodejs.org and try again.",
                AppName + " - 缺少运行环境", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        BuildTray();

        // Single instance: if something already answers on the port, just attach.
        if (HealthOk())
        {
            ShowTrayMessage("已连接到运行中的实例 / Connected to the running instance");
        }
        else
        {
            if (!StartServer())
            {
                tray.Visible = false;
                return;
            }
            ShowTrayMessage("正在启动，请稍候… / Starting, please wait…");
        }

        // Open the window once the server answers, on the UI thread and only
        // after the instance can actually serve: the user never lands on a
        // connection error and concludes the application is broken.
        bool opened = false;
        var waiter = new System.Windows.Forms.Timer { Interval = 400 };
        waiter.Tick += (s, e) =>
        {
            if (opened) return;
            if (HealthOk())
            {
                opened = true;
                waiter.Stop();
                OpenWindow(browserMode, capturePath);
            }
        };
        waiter.Start();

        Application.Run();
    }

    // -------------------------------------------------------------- selftest --

    /// <summary>
    /// Verify the launcher end to end without a GUI: find the runtime, start the
    /// server, wait for the port, hit the health endpoint, then stop everything.
    /// Used by scripts/build-desktop.js so a broken launcher fails the build
    /// instead of failing silently on a user's machine.
    /// </summary>
    static void RunSelfTest()
    {
        int failures = 0;
        Action<string, bool, string> check = (name, ok, detail) =>
        {
            Console.WriteLine((ok ? "  PASS  " : "  FAIL  ") + name + (detail.Length > 0 ? "  [" + detail + "]" : ""));
            if (!ok) failures++;
        };

        Console.WriteLine();
        Console.WriteLine("  LeebertyGXP - desktop launcher self-test");
        Console.WriteLine("  " + new string('=', 66));
        Console.WriteLine();
        Console.WriteLine("  root        " + root);
        Console.WriteLine("  port        " + port);
        Console.WriteLine();

        check("Node.js runtime is discoverable", nodeExe != null, nodeExe ?? "not found");
        check("Edge is discoverable for the app window", edgeExe != null,
            edgeExe ?? "not found - will fall back to the default browser");
        check("the server entry point exists", File.Exists(Path.Combine(root, "src", "server.js")),
            Path.Combine(root, "src", "server.js"));
        check("the desktop icon can be drawn without a resource file", MakeIcon() != null, "generated");
        check("the WebView2 SDK bindings are beside the exe", WebView2SdkPresent(),
            "Core.dll / WinForms.dll / WebView2Loader.dll");
        check("a WebView2 environment can be created (native window)", CanCreateWebViewEnvironment(),
            FindWebViewRuntime() ?? "no runtime / EdgeCore engine found");
        check("the window chrome can be themed (dark title bar, rounded corners)",
            CanApplyWindowChrome(), WindowTheme.Describe());
        check("the health probe reports no server on a free port", !HealthOk(), "port " + port);

        if (nodeExe == null) { Console.WriteLine("\n  " + failures + " failure(s)\n"); Environment.Exit(1); }

        // Start the server exactly as the GUI path would, then confirm it answers.
        bool started = StartServer();
        check("the server starts as a hidden child process", started,
            serverProcess != null ? "pid " + serverProcess.Id : "no process");

        bool healthy = false;
        for (int i = 0; i < 40; i++)
        {
            if (HealthOk()) { healthy = true; break; }
            Thread.Sleep(250);
        }
        check("the server answers on the expected port within 10 seconds", healthy,
            "port " + port);

        // The launcher must not leave orphans: this is what makes start/stop safe
        // to repeat, which matters when the monitor holds the database open.
        StopServer();
        Thread.Sleep(1200);
        bool gone = true;
        for (int i = 0; i < 20; i++)
        {
            if (!HealthOk()) { gone = true; break; }
            gone = false;
            Thread.Sleep(250);
        }
        check("stopping the launcher releases the port", gone, gone ? "released" : "still listening");

        Console.WriteLine();
        Console.WriteLine(failures == 0
            ? "  SELF-TEST PASSED - the launcher starts, serves and stops cleanly"
            : "  SELF-TEST FAILED - " + failures + " check(s) failed");
        Console.WriteLine();
        Environment.Exit(failures == 0 ? 0 : 1);
    }

    // ------------------------------------------------------------- discovery --

    static string FindNode()
    {
        string[] candidates = new string[]
        {
            Path.Combine(root, "node", "node.exe"),
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"),
        };
        foreach (string c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return null;
    }

    static string FindEdge()
    {
        string[] candidates = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
        };
        foreach (string c in candidates)
        {
            if (File.Exists(c)) return c;
        }
        return null;
    }

    static string BaseUrl { get { return "http://127.0.0.1:" + port; } }

    static bool HealthOk()
    {
        try
        {
            using (var client = new TcpClient())
            {
                var task = client.ConnectAsync("127.0.0.1", int.Parse(port));
                if (!task.Wait(1200)) return false;
                // A TCP connect is enough: the port is held by our server, and a
                // full HTTP probe would only add latency to start-up.
                return client.Connected;
            }
        }
        catch { return false; }
    }

    // ---------------------------------------------------------------- server --

    static bool StartServer()
    {
        string serverJs = Path.Combine(root, "src", "server.js");
        if (!File.Exists(serverJs))
        {
            MessageBox.Show(
                "未找到 src\\server.js，请确认启动器与程序文件在同一目录。\r\n" +
                "src\\server.js was not found; keep the launcher beside the application files.",
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }

        var psi = new ProcessStartInfo(nodeExe, "\"" + serverJs + "\"")
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        // Override a handful of variables for the child server. Wrapped on
        // purpose: if the environment contains keys that differ only by case
        // (NO_PROXY / no_proxy is the classic), .NET Framework's
        // EnvironmentVariables collection throws an ArgumentException on first
        // touch, and the launcher would die with a management dialog on a machine
        // that is otherwise perfectly fine. The overrides are conveniences - the
        // child inherits this process's environment anyway - so degrade to
        // inheritance and carry on, logging the fact.
        try
        {
            psi.EnvironmentVariables["GXP_PORT"] = port;
            psi.EnvironmentVariables["GXP_OPEN_BROWSER"] = "0";
            // A click-and-use instance ships with the built-in cast, which also
            // turns on first-run seeding: the server loads the configuration
            // library, creates the demonstration accounts, and generates the
            // demonstration dataset when the instance holds no records yet. That
            // is what makes ONE double-click enough - there is no separate
            // "generate demo data" step for the user to discover.
            if (Environment.GetEnvironmentVariable("GXP_BUILTIN_ACCOUNTS") == null)
            {
                psi.EnvironmentVariables["GXP_BUILTIN_ACCOUNTS"] = "1";
            }
        }
        catch (ArgumentException)
        {
            LogLine("environment overrides skipped: duplicate-case variable names present");
        }

        try
        {
            serverProcess = new Process();
            serverProcess.StartInfo = psi;
            // Drain the pipes so the child never blocks on a full output buffer.
            serverProcess.OutputDataReceived += (s, e) => { };
            serverProcess.ErrorDataReceived += (s, e) =>
            {
                if (e.Data != null) LogLine("[server] " + e.Data);
            };
            serverProcess.Start();
            serverProcess.BeginOutputReadLine();
            serverProcess.BeginErrorReadLine();
            weStartedServer = true;
            LogLine("server started, pid " + serverProcess.Id);
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败 / Failed to start:\r\n" + ex.Message, AppName,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
    }

    static void StopServer()
    {
        if (!weStartedServer || serverProcess == null) return;
        try
        {
            if (!serverProcess.HasExited)
            {
                serverProcess.Kill();
                serverProcess.WaitForExit(5000);
            }
        }
        catch { }
        finally
        {
            // The monitor runs as a child of the server; killing the tree above
            // covers it, but a stray node holding the database open would block
            // the next start, so sweep any remaining listener on our port.
            KillPortHolder();
        }
        serverProcess = null;
        weStartedServer = false;
    }

    static void KillPortHolder()
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c netstat -ano -p TCP | findstr LISTENING | findstr :" + port)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true,
            };
            var p = Process.Start(psi);
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(4000);
            foreach (string line in output.Split('\n'))
            {
                string[] parts = line.Trim().Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5) continue;
                int pid;
                if (!int.TryParse(parts[parts.Length - 1], out pid)) continue;
                try { Process.GetProcessById(pid).Kill(); } catch { }
            }
        }
        catch { }
    }

    // ----------------------------------------------------------------- window --

    static void OpenWindow(bool browserMode, string capturePath)
    {
        if (!HealthOk())
        {
            ShowTrayMessage("服务未能启动，请查看日志 / The server did not start; check the log");
            return;
        }
        if (browserMode || !WebView2SdkPresent())
        {
            if (!browserMode) LogLine("WebView2 SDK files missing beside the exe; falling back to an Edge app window");
            OpenWindowEdge();
            return;
        }
        try
        {
            if (OpenWindowNative(capturePath)) return;
            LogLine("native window could not be created; falling back to an Edge app window");
        }
        catch (Exception ex)
        {
            LogLine("native window failed: " + ex.Message);
        }
        OpenWindowEdge();
    }

    /// <summary>The legacy Edge --app window; remains a fallback and --browser.</summary>
    static void OpenWindowEdge()
    {
        try
        {
            if (edgeExe != null)
            {
                string profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "LeebertyGXP", "edge-profile");
                Directory.CreateDirectory(profile);
                string args = "--app=" + BaseUrl + " --user-data-dir=\"" + profile + "\""
                    + " --no-first-run --no-default-browser-check --disable-features=Translate,msEdgeTranslate";
                Process.Start(new ProcessStartInfo(edgeExe, args) { UseShellExecute = false });
                return;
            }
            Process.Start(new ProcessStartInfo(BaseUrl) { UseShellExecute = true });
        }
        catch
        {
            try { Process.Start(new ProcessStartInfo(BaseUrl) { UseShellExecute = true }); } catch { }
        }
    }

    static void OpenInBrowser()
    {
        try { Process.Start(new ProcessStartInfo(BaseUrl) { UseShellExecute = true }); } catch { }
    }

    /// <summary>
    /// The WebView2 SDK bindings that must sit beside the launcher at runtime.
    /// They are Microsoft's redistributable window-hosting component - the
    /// compiler itself could not reference anything it does not have.
    /// </summary>
    static bool WebView2SdkPresent()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        return File.Exists(Path.Combine(dir, "Microsoft.Web.WebView2.Core.dll"))
            && File.Exists(Path.Combine(dir, "Microsoft.Web.WebView2.WinForms.dll"))
            && File.Exists(Path.Combine(dir, "WebView2Loader.dll"));
    }

    /// <summary>
    /// A WebView2 environment. Prefer the standalone runtime folder; when it is
    /// absent (as on this machine) point the SDK at Edge's own engine folder
    /// (EdgeCore), which the SDK accepts as a browser executable folder. The
    /// engine runs inside our window either way - nothing opens a browser chrome.
    /// </summary>
    static string FindWebViewRuntime()
    {
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string runtimeRoot = Path.Combine(pf86, "Microsoft", "EdgeWebView", "Application");
        if (Directory.Exists(runtimeRoot))
        {
            var dirs = Directory.GetDirectories(runtimeRoot).OrderByDescending(d => d).ToArray();
            if (dirs.Length > 0 && File.Exists(Path.Combine(dirs[0], "msedgewebview2.exe"))) return dirs[0];
        }
        string edgeCore = Path.Combine(pf86, "Microsoft", "EdgeCore");
        if (Directory.Exists(edgeCore))
        {
            var dirs = Directory.GetDirectories(edgeCore).OrderByDescending(d => d).ToArray();
            foreach (string d in dirs)
            {
                if (File.Exists(Path.Combine(d, "msedgewebview2.exe"))) return d;
            }
        }
        if (edgeExe != null)
        {
            string dir = Path.GetDirectoryName(edgeExe);
            if (dir != null && File.Exists(Path.Combine(dir, "msedgewebview2.exe"))) return dir;
        }
        return null;
    }

    /// <summary>
    /// Prove that the window chrome can be themed without putting a window on
    /// screen. The frame is the one part of the design system the browser suites
    /// cannot reach, so it is checked here.
    ///
    /// The handle is created without Show(): DwmSetWindowAttribute works on a
    /// window that exists but is not visible, so the self-test never flashes a
    /// window at whoever is watching the build.
    /// </summary>
    static bool CanApplyWindowChrome()
    {
        try
        {
            using (var probe = new Form())
            {
                probe.ShowInTaskbar = false;
                probe.FormBorderStyle = FormBorderStyle.FixedToolWindow;
                IntPtr handle = probe.Handle;             // creates it, does not show it
                if (handle == IntPtr.Zero) return false;
                return WindowTheme.Apply(probe, WindowTheme.IsDark());
            }
        }
        catch (Exception ex)
        {
            LogLine("window chrome probe failed: " + ex.Message);
            return false;
        }
    }

    /// <summary>
    /// Build the real window: our frame (title, icon, size) with an embedded
    /// WebView2 control pointed at the local server. When capturePath is set the
    /// window renders, waits for a page load, saves a PNG of its own content and
    /// closes - the headless proof that the native window actually renders the
    /// application, used by the build script to verify itself.
    /// </summary>
    static bool OpenWindowNative(string capturePath)
    {
        string runtimeDir = FindWebViewRuntime();
        if (runtimeDir == null) { LogLine("no WebView2 runtime or EdgeCore engine found"); return false; }

        string userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LeebertyGXP", "webview2");
        Directory.CreateDirectory(userData);

        CoreWebView2Environment env = null;
        try
        {
            var task = CoreWebView2Environment.CreateAsync(runtimeDir, userData, new CoreWebView2EnvironmentOptions());
            if (!task.Wait(20000)) { LogLine("WebView2 environment creation timed out"); return false; }
            env = task.Result;
        }
        catch (Exception ex)
        {
            LogLine("WebView2 environment creation failed: " + ex.Message);
            return false;
        }

        // --custom-titlebar hands the caption strip to the page, so the window has
        // to be one that can give it up: ChromeForm answers WM_NCCALCSIZE with an
        // empty non-client area. The default remains an ordinary window with the
        // standard, correctly dark-themed caption.
        Form form = WindowTheme.CustomTitleBar
            ? (Form)new WindowTheme.ChromeForm()
            : new Form();
        form.Text = AppName;
        try { form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Size = new Size(1440, 900);
        form.MinimumSize = new Size(960, 600);
        form.BackColor = Color.FromArgb(16, 32, 54);

        // Window chrome. design-system.css themes everything inside the client
        // area; the title bar, the border and the corner radius are drawn by DWM
        // and are unreachable from CSS. Attach() hooks HandleCreated rather than
        // forcing the handle here, so StartPosition still wins.
        WindowTheme.Attach(form);

        var wv = new WebView2 { Dock = DockStyle.Fill };
        form.Controls.Add(wv);

        bool capture = capturePath != null;

        wv.CoreWebView2InitializationCompleted += async (s, e) =>
        {
            if (!e.IsSuccess || wv.CoreWebView2 == null)
            {
                LogLine("webview initialization failed: " + (e.InitializationException != null ? e.InitializationException.Message : "unknown"));
                if (capture) form.Close();
                return;
            }
            try { wv.CoreWebView2.Settings.IsStatusBarEnabled = false; } catch { }

            // Keep the page in step with the window chrome. When the theme follows
            // Windows this stays Auto, which tracks the system live - the same
            // signal design-system.css reads through prefers-color-scheme. Pinning
            // it to Light or Dark here would freeze the page while the title bar
            // kept following the system.
            try
            {
                int? scheme = WindowTheme.PreferredColorScheme();
                wv.CoreWebView2.Profile.PreferredColorScheme = !scheme.HasValue
                    ? CoreWebView2PreferredColorScheme.Auto
                    : (scheme.Value == 1 ? CoreWebView2PreferredColorScheme.Dark
                                         : CoreWebView2PreferredColorScheme.Light);
            }
            catch { }

            // Custom title bar, second half. Both pieces have to be in place BEFORE
            // the first navigation: Microsoft documents IsNonClientRegionSupportEnabled
            // as taking effect "after the next navigation", and the shell marker has
            // to be registered before the document is created or the page would paint
            // one frame in the browser layout.
            //
            // If the engine refuses the setting the window keeps its standard
            // caption - extending the frame without drag regions would leave a
            // window with no caption and nothing to drag it by.
            if (WindowTheme.CustomTitleBar)
            {
                bool nonClientOk = false;
                try
                {
                    wv.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = true;
                    nonClientOk = wv.CoreWebView2.Settings.IsNonClientRegionSupportEnabled;
                }
                catch (Exception ex)
                {
                    LogLine("non-client region support unavailable: " + ex.Message);
                }

                if (nonClientOk && WindowTheme.ExtendFrameIntoClientArea(form))
                {
                    try
                    {
                        // Awaited rather than .Wait()ed: the WebView2 task posts its
                        // continuation back to this UI thread, so blocking would
                        // deadlock.
                        await wv.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                            WindowTheme.ShellMarkerScript());
                        LogLine("custom title bar: enabled");
                    }
                    catch (Exception ex)
                    {
                        LogLine("shell marker not registered: " + ex.Message);
                    }
                }
                else
                {
                    LogLine("custom title bar requested but not applied; keeping the system caption");
                }
            }

            if (capture)
            {
                int completions = 0;
                wv.CoreWebView2.NavigationCompleted += (s2, e2) =>
                {
                    if (!e2.IsSuccess) return;
                    completions++;
                    // The boot splash and the SPA are the SAME document, so a
                    // single navigation completes; wait longer so the SPA paints.
                    // (first navigation: ) then snap.
                    if (completions < 1) return;
                    var snap = new System.Windows.Forms.Timer { Interval = 6000 };
                    snap.Tick += async (s3, e3) =>
                    {
                        snap.Stop();
                        try
                        {
                            using (var fs = new FileStream(capturePath, FileMode.Create))
                            {
                                await wv.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, fs);
                            }
                            LogLine("capture written: " + capturePath);
                        }
                        catch (Exception ex) { LogLine("capture failed: " + ex.Message); }
                        form.Close();
                    };
                    snap.Start();
                };
            }

            wv.CoreWebView2.Navigate(BaseUrl);
        };

        form.Shown += (s, e) => { try { wv.Focus(); } catch { } };
        form.FormClosed += (s, e) =>
        {
            try { wv.Dispose(); } catch { }
            ShutdownAll();
            Environment.Exit(0);
        };

        // EnsureCoreWebView2Async picks the environment we created; the
        // initialization event fires on the UI thread once it is ready.
        try { wv.EnsureCoreWebView2Async(env); } catch { }
        form.Show();
        return true;
    }

    /// <summary>Stop what we own: the server (and with it the monitor child).</summary>
    static void ShutdownAll()
    {
        StopServer();
        try { if (tray != null) tray.Visible = false; } catch { }
    }

    /// <summary>Create and tear down a WebView2 environment as a smoke test.</summary>
    static bool CanCreateWebViewEnvironment()
    {
        string runtimeDir = FindWebViewRuntime();
        if (runtimeDir == null || !WebView2SdkPresent()) return false;
        try
        {
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LeebertyGXP", "webview2-selftest");
            var task = CoreWebView2Environment.CreateAsync(runtimeDir, userData, new CoreWebView2EnvironmentOptions());
            if (!task.Wait(20000)) return false;
            return task.Result != null;
        }
        catch { return false; }
    }

    /// <summary>Run one of the project's command-line tools in a visible console
    /// so the operator can read the output, which is the point of these actions.</summary>
    static void RunTool(string arguments, string title)
    {
        try
        {
            string cmd = "\"" + nodeExe + "\" " + arguments + " & echo. & echo " + title + " & pause";
            Process.Start(new ProcessStartInfo("cmd.exe", "/k chcp 65001 >nul & " + cmd)
            {
                WorkingDirectory = root,
                UseShellExecute = true,
            });
        }
        catch (Exception ex) { ShowTrayMessage("无法运行 / Cannot run: " + ex.Message); }
    }

    // ------------------------------------------------------------------ tray --

    static void BuildTray()
    {
        tray = new NotifyIcon();
        tray.Icon = MakeIcon();
        tray.Text = AppName;
        tray.Visible = true;

        var menu = new ContextMenuStrip();
        menu.Items.Add(MenuItem("打开工作台 / Open", (s, e) => OpenWindow(false, null), true));
        menu.Items.Add(MenuItem("在浏览器中打开 / Open in browser", (s, e) => OpenInBrowser(), false));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(MenuItem("生成演示数据 / Generate demo data",
            (s, e) => RunTool("\"scripts\\seed-demo.js\"", "演示数据已生成 / demo data generated"), false));
        menu.Items.Add(MenuItem("校验审计追踪 / Verify audit trail",
            (s, e) => RunTool("\"scripts\\verify-audit.js\"", "校验完成 / verification complete"), false));
        menu.Items.Add(MenuItem("备份数据 / Back up data",
            (s, e) => RunTool("\"scripts\\backup.js\"", "备份完成 / backup complete"), false));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(MenuItem("停止并退出 / Stop and exit", (s, e) =>
        {
            if (MessageBox.Show(
                "将停止服务与后台工作流进程。\r\n数据已提交到磁盘，可以安全退出。\r\n\r\n" +
                "This stops the server and the background workflow monitor.\r\nThe data is already committed to disk.",
                AppName, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) == DialogResult.OK)
            {
                StopServer();
                tray.Visible = false;
                Application.Exit();
            }
        }, false));

        tray.ContextMenuStrip = menu;
        // Double-click is the fastest path back to the window.
        tray.DoubleClick += (s, e) => OpenWindow(false, null);
    }

    static ToolStripMenuItem MenuItem(string text, EventHandler handler, bool bold)
    {
        var item = new ToolStripMenuItem(text);
        item.Click += handler;
        if (bold) item.Font = new Font(item.Font, FontStyle.Bold);
        return item;
    }

    static void ShowTrayMessage(string message)
    {
        try { tray.ShowBalloonTip(2500, AppName, message, ToolTipIcon.Info); } catch { }
    }

    /// <summary>
    /// Draw the tray icon at runtime so the build needs no .ico resource and the
    /// launcher stays a single self-contained .cs file.
    /// </summary>
    static Icon MakeIcon()
    {
        // Blue-black ground, the GXP monogram in a gothic letterform stretched
        // vertically - the same identity family as the page favicon. At 32x32 the
        // stretch is subtle, but the ground and glow should still read as the
        // workbench rather than as a generic green dot.
        var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;

            using (var grad = new System.Drawing.Drawing2D.LinearGradientBrush(
                new Rectangle(0, 0, 32, 32),
                Color.FromArgb(16, 32, 84),   // deep navy, top-left
                Color.FromArgb(2, 4, 12),     // near black, bottom-right
                System.Drawing.Drawing2D.LinearGradientMode.ForwardDiagonal))
            {
                g.FillRectangle(grad, 0, 0, 32, 32);
            }

            // A faint halo so the dark ground does not read as an empty square.
            using (var glow = new SolidBrush(Color.FromArgb(36, 74, 150, 255)))
            {
                g.FillEllipse(glow, 2, 1, 28, 24);
            }

            // A thin border echoing the page's blue ring.
            using (var pen = new Pen(Color.FromArgb(120, 160, 255), 1.2f))
            {
                g.DrawEllipse(pen, 1.4f, 1.4f, 29.2f, 29.2f);
            }

            // The monogram: gothic face if present, stretched ~1.45x vertically.
            g.TranslateTransform(16, 21);
            g.ScaleTransform(0.82f, 1.6f);
            using (var font = new Font("Old English Text MT", 15f, FontStyle.Regular, GraphicsUnit.Pixel))
            {
                using (var brush = new SolidBrush(Color.FromArgb(233, 240, 255)))
                {
                    var sz = g.MeasureString("GXP", font);
                    g.DrawString("GXP", font, brush, -sz.Width / 2f, -sz.Height / 2f);
                }
            }
            g.ResetTransform();
        }
        IntPtr handle = bmp.GetHicon();
        return Icon.FromHandle(handle);
    }

    static void LogLine(string line)
    {
        try
        {
            string dir = Path.Combine(root, "logs");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "desktop.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + Environment.NewLine);
        }
        catch { }
    }
}
