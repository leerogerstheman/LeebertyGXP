'use strict';

/**
 * Checks for the operational layer: production batch execution and account
 * provisioning.
 *
 * WHY THIS EXISTS
 * ---------------
 * The workbench's quality processes (deviation, CAPA, inspection) were always
 * credible, but the OPERATOR's working day was not modelled - a production
 * operator logged in and had almost nothing that looked like production work. The
 * BATCH-EXEC process and its four seeded batches fix that: the operator's inbox
 * holds real batch steps (issue material, charge, sample), the manager reviews,
 * QC/QP dispose.
 *
 * The second half is account provisioning: the "new user" entry point existed but
 * was reachable only by the administrator, and a new account had no way to declare
 * which areas it works in. The checks here assert the whole chain: create, appear
 * in the identity list, land in the right area, sign in, and be on the audit
 * trail.
 *
 * Everything is driven over HTTP against a real server, because the point is that
 * the integer parts fit together, not that each module works alone.
 */

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) { passed += 1; process.stdout.write(`  \u2713 ${name}\n`); }
  else { failed += 1; process.stdout.write(`  \u2717 ${name}${detail ? ` - ${detail}` : ''}\n`); }
}

async function main() {
  process.stdout.write('\n  LeebertyGXP -  operations: batches and account provisioning\n\n');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gxp-ops-'));
  const dbFile = path.join(dataDir, 'gxp.db');
  const port = 8860 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, GXP_DB_FILE: dbFile, GXP_BUILTIN_ACCOUNTS: '1',
    GXP_PORT: String(port), GXP_HOST: '127.0.0.1', GXP_MONITOR: '0',
  };
  let server = null;

  const run = (script) => execFileSync(NODE, [path.join(ROOT, script)], {
    cwd: ROOT, env, stdio: 'ignore', timeout: 120000,
  });

  try {
    run('scripts/seed.js');
    run('scripts/seed-demo.js');

    server = spawn(NODE, [path.join(ROOT, 'src', 'server.js')], { cwd: ROOT, env, stdio: 'ignore' });
    let up = false;
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`${base}/api/health`); if (r.status === 200) { up = true; break; } } catch { /* not yet */ }
      await sleep(400);
    }
    check('the instance serves', up);
    if (!up) throw new Error('server did not come up');

    const login = async (username, password = 'GxP-Demo-2026!') => {
      const r = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (r.status !== 200) return null;
      return { cookie: r.headers.get('set-cookie').split(';')[0], status: r.status };
    };
    const api = async (method, p, cookie, body) => {
      const r = await fetch(`${base}${p}`, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json = null;
      try { json = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, json };
    };

    // ---- the batch process is registered and seeded ----------------------
    const op = await login('prod.operator');
    check('the production operator signs in', Boolean(op));
    const admin = await login('admin');
    check('the system administrator signs in', Boolean(admin));

    const pt = await api('GET', '/api/process-types?', op.cookie);
    const ptRows = (pt.json && pt.json.rows) || [];
    check('the production batch execution process is registered',
      pt.status === 200 && ptRows.some((r) => r.code === 'BATCH-EXEC')
        && ptRows.length === 17,
      `${ptRows.length} process types`);

    const opRec = await api('GET', '/api/records?limit=100', op.cookie);
    const batches = (opRec.json.rows || []).filter((r) => r.processType === 'BATCH-EXEC' || r.processCode === 'BATCH-EXEC');
    check('four demonstration batches are seeded', batches.length === 4, `${batches.length} batches`);
    const byKey = {};
    for (const b of batches) byKey[b.recordKey || b.code] = b;
    const steps = ['PRD-2026-0001', 'PRD-2026-0002', 'PRD-2026-0003', 'PRD-2026-0004']
      .map((k) => (byKey[k] ? byKey[k].currentStep || byKey[k].current_step : null));
    check('the batches are seeded at four successive steps',
      steps[0] === 'material_issue' && steps[1] === 'charge_and_parameters'
        && steps[2] === 'process_sampling' && steps[3] === 'batch_disposition',
      steps.join(' -> '));

    // ---- the operator's working day is real work --------------------------
    const inbox = await api('GET', '/api/inbox?limit=50', op.cookie);
    const batchItems = (inbox.json.items || []).filter((i) => i.processCode === 'BATCH-EXEC');
    check('the operator\'s inbox holds the batch steps',
      batchItems.length === 3,
      `${batchItems.length} batch items for the operator`);

    // Complete the first batch's material-issue step with its required fields.
    const first = byKey['PRD-2026-0001'];
    const done = await api('POST', `/api/records/${first.id}/steps/complete`, op.cookie, {
      stepCode: 'material_issue',
      formData: {
        materialCode: 'MAT-AP-01', materialLot: 'M2026-0515',
        quantityKg: '84.0', materialStatus: '合格',
        checks: '品名、批号、数量一致；包装完好；在库效期内。',
      },
      comment: '操作日志：领料核对完成',
    });
    check('the operator completes the material-issue step with its fields',
      done.status === 200, `status ${done.status}`);
    const after = await api('GET', `/api/records/${first.id}`, op.cookie);
    check('the batch advances to the charge step',
      (after.json.currentStep || after.json.current_step) === 'charge_and_parameters',
      `step ${after.json.currentStep || after.json.current_step}`);

    // A role that does not own the step is refused.
    const qc = await login('qc.manager');
    const second = byKey['PRD-2026-0002'];
    const refused = await api('POST', `/api/records/${second.id}/steps/complete`, qc.cookie, {
      stepCode: 'charge_and_parameters',
      formData: { chargeQtyKg: '84.0', mixingTimeMin: '25', mixingSpeed: '20', temperature: '36', paramCheck: '达标' },
    });
    check('a role outside the step is refused',
      refused.status === 403 || refused.status === 401, `status ${refused.status}`);

    // The QC manager's inbox holds the disposition approval for PRD-0004.
    const qcInbox = await api('GET', '/api/inbox?limit=50', qc.cookie);
    const qcDispo = (qcInbox.json.items || []).filter(
      (i) => i.processCode === 'BATCH-EXEC' && (i.stepCode || i.step) === 'batch_disposition'
    );
    check('the QC manager holds the batch disposition approval',
      qcDispo.length === 1 && qcDispo[0].requiresSignature === true,
      JSON.stringify(qcDispo.map((i) => i.stepCode || i.step)));

    // ---- account provisioning: create, list, land, sign in ------------------
    const created = await api('POST', '/api/users', admin.cookie, {
      username: 'new.analyst', fullName: '新入职分析员', fullNameEn: 'New Analyst',
      role: 'qc_analyst', department: '质量控制部', jobTitle: 'QC 分析员',
      gxpAreas: ['GMP'], password: 'Temp-Pass-123!', mustChangePassword: true,
    });
    check('an administrator can create a new user',
      created.status === 201 && created.json.user && created.json.user.username === 'new.analyst',
      `status ${created.status}`);

    const choices = await api('GET', '/api/login-choices?', null);
    const persona = (choices.json.personas || []).find((p) => p.username === 'new.analyst');
    check('the new user appears in the identity list',
      Boolean(persona), JSON.stringify((choices.json.personas || []).map((p) => p.username).slice(-3)));
    check('the new user inherits the role\'s scope and landing',
      persona && persona.scope === 'domain' && persona.landing && persona.landing.domain === 'GMP',
      JSON.stringify(persona && persona.landing));

    const newLogin = await login('new.analyst', 'Temp-Pass-123!');
    check('the new user can sign in with their own password', Boolean(newLogin), 'login failed');

    const gmp = await api('GET', '/api/domain/GMP?', op.cookie);
    const qcAccounts = gmp.json.roleAccounts && gmp.json.roleAccounts.qc_analyst
      ? (gmp.json.roleAccounts.qc_analyst.accounts || []).map((a) => a.username) : [];
    check('the new analyst appears on the GMP roster',
      qcAccounts.includes('new.analyst'), qcAccounts.join(', '));

    const audit = await api('GET', '/api/audit?entityType=users&limit=100', admin.cookie);
    const createEntry = (audit.json.rows || []).find(
      (r) => r.action === 'create' && /new\.analyst/.test(JSON.stringify(r))
    );
    check('account creation is on the audit trail',
      Boolean(createEntry), 'no create entry found');

    const chain = await api('GET', '/api/audit/verify', admin.cookie);
    check('the audit chain verifies after batch execution and provisioning',
      chain.json && chain.json.ok === true, JSON.stringify(chain.json).slice(0, 120));
  } finally {
    if (server) { try { server.kill(); } catch { /* gone */ } }
    await sleep(600);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  process.stdout.write(`\n  ${passed} passed, ${failed} failed (${passed + failed} checks)\n\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`\n  Operations test crashed: ${err.stack}\n\n`);
  process.exit(1);
});