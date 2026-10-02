'use strict';

/**
 * Application entry point.
 *
 *   node src/server.js            start on http://127.0.0.1:8788
 *   GXP_PORT=9000 node src/server.js
 *
 * Environment:
 *   GXP_HOST               bind address (default 127.0.0.1; 0.0.0.0 to publish on a LAN)
 *   GXP_PORT               listen port (default 8788)
 *   GXP_DATA_DIR           directory for the database and the audit chain key
 *   GXP_SIG_2FA=0          disable the second factor for e-signatures (not recommended)
 *   GXP_OPEN_BROWSER=1     open the default browser after start
 */

const config = require('./config');
const db = require('./core/db');
const audit = require('./core/audit');
const accounts = require('./domain/accounts');
const seed = require('./seed');
const bootstrap = require('./bootstrap');
const server = require('./api/server');

/**
 * Console banner.
 *
 * This text is Chinese-first and reaches the terminal as UTF-8, because
 * start.bat is a pure-ASCII batch file and can therefore safely run
 * `chcp 65001` before launching Node. That is why the batch files contain no
 * Chinese of their own: cmd.exe reads .bat files using the *active* code page,
 * so mixing non-ASCII batch content with a console code-page switch corrupts
 * cmd's read offset and floods the screen with spurious errors.
 */
function banner(url, chain, seeded, accountSummary, monitorRunning) {
  const entries = chain.checked;
  const lines = [
    '',
    '  ============================================================',
    `   LeebertyGXP   v${config.app.version}`,
    '   GxP compliance workbench · 合规工作台',
    '  ============================================================',
    '',
    `   访问地址 / URL      ${url}`,
    `   数据文件 / Data     ${config.dbFile}`,
    `   Node 版本           ${process.version}`,
    '',
    `   审计追踪 / Audit    ${chain.ok ? `完整 ✓ 已校验 ${entries} 条` : '*** 完整性校验失败 ***'}`,
    `   配置库   / Config   ${seeded.processTypes} 类流程定义, ${seeded.checklistTemplates} 张检查表`,
    `   后台进程 / Monitor  ${monitorRunning ? '运行中（定时扫描超期并生成待办）' : '未启用'}`,
    '',
  ];

  if (accountSummary.enabled) {
    // The banner used to list the nine curated personas. There are twenty
    // accounts now, and the first screen is a domain picker rather than a list of
    // job titles, so listing people here is both long and misleading. What a
    // reader actually needs is the one password, the areas they can enter, and
    // the reminder that none of it belongs in a real GxP record.
    let areas = [];
    try { areas = accounts.loginDomains(); } catch { areas = []; }
    let headcount = accounts.PERSONAS.length;
    try { headcount = accounts.loginChoices().length; } catch { /* keep the fallback */ }
    lines.push(
      '   ------------------------------------------------------------',
      `   演示账号 / Demo accounts  ${headcount} 个身份，统一密码 / one password:`,
      `                             ${accounts.BUILTIN_PASSWORD}`,
      '',
      '   可进入的领域 / Domains you can enter:',
      `     ${areas.map((a) => a.code).join('  ')}`,
      '',
      '   打开后先选领域，再在该领域的岗位中选择身份。',
      '   Open the app, pick a domain, then pick an identity inside it.',
      '',
      '   ⚠  这是演示配置：账号与密码是公开的，请勿用于真实 GxP 记录。',
      '      如需关闭：设置环境变量 GXP_BUILTIN_ACCOUNTS=0 后重启。',
      '      Demo configuration: these credentials are public. Unset',
      '      GXP_BUILTIN_ACCOUNTS to disable before holding real records.',
      ''
    );
  } else {
    lines.push(
      '   ------------------------------------------------------------',
      '   首次使用请在浏览器中创建第一个管理员账号。',
      '   On first use, create the first administrator account in the browser.',
      '',
      '   如需开箱即用的多角色演示账号，请用以下方式启动：',
      '   For click-and-use demo logins, start with built-in accounts:',
      '     set GXP_BUILTIN_ACCOUNTS=1 && start.bat',
      ''
    );
  }

  lines.push(
    '   数据目录包含数据库与审计链密钥，请整体定期备份。',
    '   缺少 audit-chain.key 的备份无法校验审计追踪，且无法修复。',
    '   Back up the whole data folder; a backup without audit-chain.key',
    '   cannot verify the audit trail, and that cannot be repaired.',
    '',
    '   关闭本窗口即停止服务。 / Closing this window stops the service.',
    '   ------------------------------------------------------------',
    '',
    config.http.host === '127.0.0.1'
      ? '   仅监听本机 / localhost only. 局域网共享请设 GXP_HOST=0.0.0.0。'
      : `   已发布在 ${config.http.host} / published - 共享使用请在前端配置 HTTPS。`,
    '',
    '   Ctrl+C 停止 / press Ctrl+C to stop.',
    ''
  );
  return lines.join('\n');
}

/**
 * Open the workbench in its own application window rather than a browser tab.
 *
 * WHY NOT THE DEFAULT BROWSER
 * ---------------------------
 * This used to run `cmd /c start "" url`, which opens the system default browser
 * in full - address bar, tabs, the whole shell. That made a desktop application
 * read as a website. The desktop launcher (desktop/Launcher.cs) already opens
 * Edge in `--app` mode, which is a chrome-less window with its own taskbar entry;
 * this gives the same window to `node src/server.js` and `start.bat`, so the two
 * entry points behave identically.
 *
 * Edge is looked up on the standard install paths, with a shared profile under
 * %LOCALAPPDATA%\LeebertyGXP so the window is independent of the user's normal
 * browsing. Only when Edge cannot be found does it fall back to the default
 * browser.
 */
function openAppWindow(url) {
  const { spawn } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');

  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData\\Local');

  const candidates = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  const edge = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });

  let args;
  if (edge) {
    const profile = path.join(local, 'LeebertyGXP', 'edge-profile');
    try { fs.mkdirSync(profile, { recursive: true }); } catch { /* best effort */ }
    args = [
      '--app=' + url,
      // No embedded quotes here: node's spawn quotes arguments containing spaces
      // automatically, whereas a literal `--user-data-dir="path"` passes the
      // quotes through as part of the value and Edge fails to start.
      '--user-data-dir=' + profile,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,msEdgeTranslate',
    ];
  } else {
    // Edge absent: last resort is the default browser, but say so on the console.
    process.stdout.write('  [browser] Edge not found; opening the default browser instead.\n');
    const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref(); } catch { /* best effort */ }
    return;
  }

  try {
    spawn(edge, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Spawn failed - try the default browser as the last resort.
    const cmd = process.platform === 'win32' ? 'cmd' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    const argv = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try { spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref(); } catch { /* opening a window is best-effort */ }
  }
}

async function main() {
  // Open the database and load the GxP configuration library before listening,
  // so a broken seed file fails loudly at start-up rather than at first use.
  db.open();

  let seeded;
  try {
    seeded = seed.run({ silent: true });
  } catch (err) {
    console.error('\n  [错误] GxP 配置库加载失败 / Failed to load the configuration library:');
    console.error(`  ${err.message}`);
    console.error('\n  请检查 seed/workflows 与 seed/checklists 下的 JSON 文件。');
    console.error('  Check the JSON files under seed/workflows and seed/checklists.\n');
    process.exit(1);
  }

  const chain = audit.verifyChain();
  if (!chain.ok && config.features.freezeOnChainBreak) {
    console.error('\n  ************************************************************');
    console.error('  ***  审计追踪完整性校验失败  AUDIT TRAIL INTEGRITY FAILURE  ***');
    console.error('  ************************************************************\n');
    console.error(`  断点 / broken at sequence: ${chain.brokenAt}`);
    console.error(`  原因 / reason: ${chain.reason}\n`);
    console.error('  请按数据完整性事件处理，不要继续使用本系统：');
    console.error('    1. 立即停止操作本系统，不要反复重启；');
    console.error('    2. 原样保全 data 目录（含 gxp.db 与 audit-chain.key），不要修改；');
    console.error('    3. 不要尝试重建或修复哈希链；');
    console.error('    4. 通知系统负责人并开具数据完整性事件记录。\n');
    console.error('  Treat this as a data integrity incident: stop, preserve the data folder');
    console.error('  untouched, do not attempt to rebuild the chain, and notify the system owner.');
    console.error('  To start anyway for investigation only, set GXP_FREEZE_ON_CHAIN_BREAK=0.\n');
    process.exit(2);
  }

  let httpServer;
  try {
    // Bind first, then provision and start the monitor, so a client that
    // connects before provisioning finishes waits rather than being told the
    // instance does not exist yet.
    httpServer = await server.start();
  } catch (err) {
    console.error(`\n  [错误] 服务启动失败 / Failed to start: ${err.message}\n`);
    process.exit(1);
  }

  // ------------------------------------------------- built-in demo accounts --
  // Opt-in. Provisions the persona cast so a click-and-use instance has working
  // per-role logins from the very first screen, instead of asking the user to
  // invent eleven accounts before anything can be demonstrated.
  let accountSummary = { enabled: false, created: 0, refreshed: 0 };
  try {
    accountSummary = accounts.provision(
      db.get("SELECT * FROM users WHERE role = 'system_admin' AND status = 'active' ORDER BY id LIMIT 1"),
      { ip: '127.0.0.1', userAgent: 'server-startup', sessionId: null }
    );
  } catch (err) {
    console.error(`  [builtin-accounts] provisioning failed: ${err.message}`);
  }

  // ------------------------------------------------- demonstration dataset --
  // Provision itself, so the application is worth looking at after one
  // double-click. Previously this needed a separate script to be run first,
  // which the desktop shortcut gave no hint of.
  //
  // It runs only when the instance holds no GxP records at all, so an instance
  // with real work in it is never touched, and the second launch does nothing.
  let demo = { ran: false, reason: 'skipped' };
  if (config.features.autoSeedDemo) {
    const startedAt = Date.now();
    try {
      demo = await bootstrap.ensureDemoData();
    } catch (err) {
      demo = { ran: false, reason: err.message };
    }
    if (demo.ran) {
      // Re-verify the chain: the seeder wrote several hundred entries through the
      // same audited path a human would, so this is the first honest chance to
      // confirm the ledger is still intact.
      const after = audit.verifyChain();
      demo.chainOk = after.ok;
      demo.entries = after.checked;
      demo.seconds = (Date.now() - startedAt) / 1000;
    }
  } else if (!bootstrap.hasQualityRecords() && accountSummary.enabled) {
    demo = { ran: false, reason: 'automatic seeding is switched off' };
  }

  // Only now is the instance genuinely ready to serve a first-time visitor: the
  // login screen's persona list is populated and the monitor is about to run.
  server.markReady();

  // ------------------------------------------------------ background monitor --
  // Runs as a child process so the two independent jobs - serving requests and
  // chasing deadlines - cannot take each other down, and so a monitor crash is
  // visible in the log rather than silently stopping the workflow.
  let monitorProcess = null;
  if (config.features.backgroundMonitor && process.env.GXP_NO_MONITOR !== '1') {
    try {
      const { spawn } = require('node:child_process');
      monitorProcess = spawn(
        process.execPath,
        [require('node:path').join(__dirname, 'daemon', 'monitor.js'),
          '--interval', String(process.env.GXP_MONITOR_INTERVAL || 300)],
        {
          cwd: config.root,
          env: process.env,
          stdio: ['ignore', 'inherit', 'inherit'],
          windowsHide: true,
        }
      );
      monitorProcess.on('exit', (code, signal) => {
        if (code !== 0 && signal !== 'SIGTERM') {
          process.stderr.write(`  [monitor] exited unexpectedly (code ${code}); workflow deadlines will not be chased.\n`);
        }
      });
      monitorProcess.on('error', (err) => {
        process.stderr.write(`  [monitor] could not start: ${err.message}\n`);
      });
    } catch (err) {
      process.stderr.write(`  [monitor] could not start: ${err.message}\n`);
    }
  }

  const host = config.http.host === '0.0.0.0' ? 'localhost' : config.http.host;
  const url = `http://${host}:${config.http.port}`;
  process.stdout.write(banner(url, chain, seeded, accountSummary, Boolean(monitorProcess)));

  if (accountSummary.enabled && (accountSummary.created || accountSummary.refreshed)) {
    process.stdout.write(`   Built-in accounts provisioned: ${accountSummary.created} created, `
      + `${accountSummary.refreshed} refreshed.\n`);
  }
  if (demo.ran) {
    process.stdout.write(`   演示数据   / Demo data  ${demo.records} 条质量记录, ${demo.entries} 条审计记录, `
      + `哈希链校验 ${demo.chainOk ? '通过' : '失败'} (${demo.seconds.toFixed(1)}s)\n`);
  } else if (!bootstrap.hasQualityRecords()) {
    process.stdout.write(`   演示数据   / Demo data  未生成 (${demo.reason}); 可用 scripts/seed-demo.js 手工生成\n`);
  }

  if (process.env.GXP_OPEN_BROWSER === '1') {
    openAppWindow(url);
  }

  let shuttingDown = false;
  const stopMonitor = () => {
    if (!monitorProcess || monitorProcess.killed) return;
    try {
      // SIGTERM lets the monitor flush its counters and close the database
      // cleanly, which matters because it shares the file with this process.
      monitorProcess.kill('SIGTERM');
    } catch { /* already gone */ }
  };

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n  ${signal} received, shutting down...\n`);
    stopMonitor();
    httpServer.close(() => {
      try { db.close(); } catch { /* ignore */ }
      process.stdout.write('  Stopped cleanly. Audit trail flushed.\n');
      process.exit(0);
    });
    // Do not hang forever waiting for keep-alive connections.
    setTimeout(() => {
      try { db.close(); } catch { /* ignore */ }
      process.exit(0);
    }, 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // A hard exit must not leave an orphaned monitor holding the database open.
  process.on('exit', stopMonitor);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n  Fatal error during start-up:');
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };
