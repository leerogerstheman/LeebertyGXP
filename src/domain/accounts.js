'use strict';

/**
 * Built-in personas for a click-and-use instance.
 *
 * WHY THIS EXISTS
 * ---------------
 * A workbench whose value comes from role separation is useless on first launch
 * if the user has to invent eleven accounts before they can see any of it. This
 * module defines a small cast that between them exercise every distinctive part
 * of the quality system - submitter, approver, investigator, auditor, warehouse
 * - so the role gates and the inbox can be demonstrated in two clicks.
 *
 * SAFETY
 * ------
 * Provisioning is opt-in and off by default in the shipped configuration:
 *
 *   GXP_BUILTIN_ACCOUNTS=1   create/refresh the personas at start-up
 *
 * A production instance must never be shipped with known credentials, so the
 * personas are also excluded from `GET /api/bootstrap` unless the same flag is
 * set, which is what makes the login screen render tiles instead of a bare form.
 * The credential is published on purpose - it is the point of a demo - and the
 * boot banner says so loudly.
 *
 * Every account is a real row in `users`, so the RBAC matrix, the signature
 * gates and the audit trail treat them exactly like human-created accounts.
 */

const config = require('../config');
const db = require('../core/db');
const auth = require('../core/auth');
const audit = require('../core/audit');

/** The single credential every built-in persona shares. */
const BUILTIN_PASSWORD = 'GxP-Demo-2026!';

/**
 * The cast. Kept deliberately small: one persona per capability boundary that
 * a new user needs to *see* in order to understand the system.
 */
const PERSONAS = [
  {
    username: 'demo.operator',
    fullName: '刘洋',
    fullNameEn: 'Liu Yang',
    role: 'production_operator',
    department: '生产部',
    jobTitle: '压片操作工',
    gxpAreas: ['GMP'],
    qualification: { GMP: true },
    blurb: '一线操作工：能提交偏差、填写批记录，看不到审计追踪，也不能批准任何东西。',
    blurbEn: 'Shop-floor operator: can raise deviations and record work, cannot see the audit trail or approve anything.',
    highlight: '看角色门如何限制一线操作',
  },
  {
    username: 'demo.prodmanager',
    fullName: '赵国强',
    fullNameEn: 'Zhao Guoqiang',
    role: 'production_manager',
    department: '生产部',
    jobTitle: '生产负责人',
    gxpAreas: ['GMP'],
    qualification: { GMP: true },
    blurb: '生产负责人：负责遏制措施、CAPA 实施与生产变更。',
    blurbEn: 'Production manager: owns containment, CAPA implementation and production change requests.',
    highlight: '待办里有遏制与实施类任务',
  },
  {
    username: 'demo.qc',
    fullName: '周晓峰',
    fullNameEn: 'Zhou Xiaofeng',
    role: 'qc_analyst',
    department: '质量控制部',
    jobTitle: 'QC 分析员',
    gxpAreas: ['GMP'],
    qualification: { GMP: true },
    blurb: 'QC 分析员：发起 OOS 调查、记录原始数据、登记仪器校准。',
    blurbEn: 'QC analyst: initiates OOS investigations, records raw data, logs calibrations.',
    highlight: '能看到 OOS 调查的完整链路',
  },
  {
    username: 'demo.qamanager',
    fullName: '李静',
    fullNameEn: 'Li Jing',
    role: 'qa_manager',
    department: '质量保证部',
    jobTitle: 'QA 负责人',
    gxpAreas: ['GMP', 'GLP', 'GDPR-DataIntegrity'],
    qualification: { GMP: true, GLP: true },
    blurb: 'QA 负责人：审批偏差与 CAPA、作出批次处置决定、查看全部待办与风险。',
    blurbEn: 'QA manager: approves deviations and CAPAs, decides batch disposition, sees everything.',
    highlight: '待办最全，审批类任务集中在这里',
  },
  {
    username: 'demo.auditor',
    fullName: '陈敏',
    fullNameEn: 'Chen Min',
    role: 'qa_auditor',
    department: '质量保证部',
    jobTitle: '内审员',
    gxpAreas: ['GMP', 'GLP'],
    qualification: { GMP: true, GLP: true },
    blurb: '内审员：执行自查、评估检查项、将缺陷转为 CAPA。不能批准自己审计的对象。',
    blurbEn: 'Internal auditor: runs self-inspections and escalates findings, but cannot approve what they audited.',
    highlight: '职责分离在这里体现得最清楚',
  },
  {
    username: 'demo.trainer',
    fullName: '黄燕',
    fullNameEn: 'Huang Yan',
    role: 'trainer',
    department: '人力资源部',
    jobTitle: '培训协调员',
    gxpAreas: ['GMP', 'GLP', 'GCP'],
    blurb: '培训协调员：分配培训、登记完成、签署 GxP 关键课程记录。',
    blurbEn: 'Training coordinator: assigns curricula, records completion, signs GxP-critical training.',
    highlight: '培训资质矩阵与签名门槛',
  },
  {
    username: 'demo.engineer',
    fullName: '郑海涛',
    fullNameEn: 'Zheng Haitao',
    role: 'engineering',
    department: '工程部',
    jobTitle: '设备工程师',
    gxpAreas: ['GMP', 'GAMP'],
    qualification: { GMP: true },
    blurb: '设备工程师：登记校准与维护，处理校准超期升级任务。',
    blurbEn: 'Equipment engineer: records calibration and maintenance, handles overdue escalations.',
    highlight: '校准不合格会自动停用设备',
  },
  {
    username: 'demo.warehouse',
    fullName: '吴建平',
    fullNameEn: 'Wu Jianping',
    role: 'warehouse_keeper',
    department: '仓储物流部',
    jobTitle: '仓储主管',
    gxpAreas: ['GDP'],
    qualification: { GDP: true },
    blurb: '仓储主管：收货验收、冷链温度记录审核、召回执行。',
    blurbEn: 'Warehouse lead: goods receipt, cold chain record review, recall execution.',
    highlight: 'GDP 领域与冷链要求',
  },
  {
    username: 'demo.viewer',
    fullName: '外部审计员',
    fullNameEn: 'External Auditor',
    role: 'auditor_external',
    department: '外部',
    jobTitle: '检查员（只读）',
    gxpAreas: ['GMP', 'GLP', 'GDPR-DataIntegrity'],
    blurb: '只读账号：可以查阅记录与审计追踪，任何查看行为本身也会被记录。',
    blurbEn: 'Read-only account: can review records and the audit trail, and every view is itself audited.',
    highlight: '只读权限 + 查看留痕',
  },
];

/** True when the instance is configured to behave as a click-and-use demo. */
function builtinAccountsEnabled() {
  return process.env.GXP_BUILTIN_ACCOUNTS === '1' || config.features.builtinAccounts === true;
}

/** Create or refresh one persona. Idempotent: safe to run on every start-up. */
function ensurePersona(persona, actor, ctx) {
  const existing = auth.getUserByUsername(persona.username);
  const at = new Date().toISOString();

  if (existing) {
    // Refresh the descriptive fields but never clobber a password the user set.
    const before = {
      full_name: existing.full_name, role: existing.role,
      department: existing.department, job_title: existing.job_title, status: existing.status,
    };
    db.run(
      'UPDATE users SET full_name = ?, full_name_en = ?, role = ?, department = ?, job_title = ?, ' +
      'gxp_areas = ?, qualification = ?, status = ?, updated_at = ? WHERE id = ?',
      [persona.fullName, persona.fullNameEn || null, persona.role, persona.department,
        persona.jobTitle, JSON.stringify(persona.gxpAreas || []),
        JSON.stringify(persona.qualification || {}), 'active', at, existing.id]
    );
    const changed = before.full_name !== persona.fullName || before.role !== persona.role
      || before.status !== 'active';
    if (changed) {
      audit.recordChange({
        actor: actor || null,
        entityType: 'users',
        entityId: existing.id,
        recordKey: `users:${existing.id}`,
        before,
        after: { full_name: persona.fullName, role: persona.role, status: 'active' },
        reason: 'Built-in persona refreshed at start-up',
        ctx: ctx || {},
        action: 'update',
      });
    }
    return { user: existing, created: false, passwordReset: false };
  }

  let id;
  db.transaction(() => {
    db.run(
      'INSERT INTO users (username, full_name, full_name_en, email, department, job_title, role, status, ' +
      'locale, gxp_areas, qualification, must_change_password, created_at, updated_at, created_by) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [persona.username, persona.fullName, persona.fullNameEn || null,
        `${persona.username}@demo.local`, persona.department, persona.jobTitle, persona.role,
        'active', 'zh-CN', JSON.stringify(persona.gxpAreas || []),
        JSON.stringify(persona.qualification || {}), 0, at, at, actor ? actor.id : null]
    );
    id = db.get('SELECT last_insert_rowid() AS id').id;
  });

  const created = auth.getUserById(id);
  auth.setPassword(id, BUILTIN_PASSWORD, actor || created, ctx || {}, {
    mustChange: false,
    reason: 'Built-in demonstration account provisioned',
  });
  audit.append({
    action: 'create',
    entityType: 'users',
    entityId: id,
    recordKey: `users:${id}`,
    actor: actor || null,
    reason: `Built-in demonstration account "${persona.username}" provisioned (${persona.role})`,
    ctx: ctx || {},
    severity: 'critical',
    newValue: {
      username: persona.username, full_name: persona.fullName, role: persona.role,
      builtin: true, password_change_required: false,
    },
  });
  return { user: auth.getUserById(id), created: true, passwordReset: true };
}

/**
 * Provision every persona. Called from server start-up when enabled.
 * @returns {{enabled:boolean, created:number, refreshed:number, personas:Array}}
 */
function provision(actor, ctx) {
  const summary = { enabled: builtinAccountsEnabled(), created: 0, refreshed: 0, personas: [] };
  if (!summary.enabled) return summary;

  for (const persona of PERSONAS) {
    try {
      const result = ensurePersona(persona, actor, ctx);
      if (result.created) summary.created += 1; else summary.refreshed += 1;
      summary.personas.push({ username: persona.username, role: persona.role, created: result.created });
    } catch (err) {
      process.stderr.write(`  [builtin-accounts] ${persona.username} failed: ${err.message}\n`);
    }
  }
  return summary;
}

/**
 * Demonstration blurbs for roles seeded by scripts/seed-demo.js.
 *
 * The start-up screen offers every account, and a card with no blurb showed only
 * a role name - informative but flat, and inconsistent with the nine curated
 * cards beside it. Written to the same standard: one sentence on what the role
 * does, one on what it cannot do or what makes it worth looking at.
 */
const ROLE_BLURBS = {
  system_admin: {
    zh: '系统管理员：维护账号、权限与系统配置。可以看到全部内容，但不能作为任何 GxP 记录的唯一批准人。',
    en: 'System administrator: maintains accounts, permissions and configuration. Sees everything, but cannot be the sole approver of any GxP record.',
    highlight: '技术权限与质量决策权被强制分离',
  },
  clinical_monitor: {
    zh: '临床监查员：核对源数据、发现方案偏离、跟踪研究中心整改。能看到受试者编号数据，但不能批准自己监查的偏离。',
    en: 'Clinical monitor: verifies source data, detects protocol deviations, tracks site remediation. Sees subject-identified data but cannot approve a deviation they monitored.',
    highlight: '知情同意类偏离通常由监查发现',
  },
  clinical_pi: {
    zh: '主要研究者：对受试者安全与医学判断负最终责任，签署受试者权益影响评估。',
    en: 'Principal investigator: ultimately accountable for subject safety and medical judgement, and signs the subject-rights impact assessment.',
    highlight: '受试者权益事件的医学判断必须由 PI 作出',
  },
  lab_manager: {
    zh: '专题负责人：对研究实施、原始数据完整性与最终报告负责。GLP 的每一项判定最终都回到这个角色。',
    en: 'Study director: accountable for study conduct, raw data integrity and the final report. Every GLP judgement lands here.',
    highlight: 'GLP 研究的单一责任人',
  },
  lab_technician: {
    zh: '实验技术员：执行研究操作并同步记录原始数据。发现异常立即报告，不擅自修正。',
    en: 'Laboratory technician: performs study procedures and records raw data contemporaneously, reporting anomalies rather than quietly correcting them.',
    highlight: '发现标本或数据问题时，第一动作是保全证据',
  },
  pharmacovigilance: {
    zh: '药物警戒专员：接收并处理个例安全性报告、检测信号、编制定期报告。时限从首次获知日起算。',
    en: 'Pharmacovigilance officer: processes ICSRs, detects signals and prepares periodic reports. The reporting clock starts at the day of first knowledge.',
    highlight: '时限起算日是药物警戒检查的最高频缺陷',
  },
  qa_specialist: {
    zh: 'QA 专员：执行调查、起草文件、跟踪整改与培训。承担大量步骤，但不作最终处置决定。',
    en: 'QA specialist: runs investigations, drafts documents, tracks actions and training. Carries many steps but makes no final disposition decision.',
    highlight: '调查者与决定者分离',
  },
  qc_manager: {
    zh: '质量控制负责人：负责 OOS 调查、方法生命周期与实验室资源，判定检验结果的有效性。',
    en: 'QC manager: owns OOS investigations, method lifecycle and laboratory resources, and judges the validity of test results.',
    highlight: '阶段一实验室调查与阶段二全面调查的分界',
  },
  qp: {
    zh: '质量受权人：按 EU GMP Annex 16 认证批次放行。放行决定不能由他人代签。',
    en: 'Qualified person: certifies batch release under EU GMP Annex 16. The release decision cannot be signed by anyone else.',
    highlight: '放行权不可委托',
  },
  ra_officer: {
    zh: '注册事务专员：维护注册事项，评估变更的法规影响，提交监管报告。',
    en: 'Regulatory affairs officer: maintains submissions, assesses the regulatory impact of changes and files reports with authorities.',
    highlight: '变更的法规影响评估',
  },
  validation_engineer: {
    zh: '验证工程师：负责 IQ/OQ/PQ 与计算机化系统生命周期。系统改了就要重新确认，不因「改动很小」而跳过。',
    en: 'Validation engineer: owns IQ/OQ/PQ and the CSV lifecycle. A system change requires re-qualification, not a judgement that the change was small.',
    highlight: 'GAMP 5 与 Annex 11 的落地角色',
  },
};

/**
 * Which GxP areas each role actually has work in, derived from the process
 * definitions rather than hand-maintained.
 *
 * WHY DERIVE IT
 * -------------
 * The start-up screen asks the user to pick a domain first, then offers only the
 * people who work in it. A hand-written mapping would drift the moment a workflow
 * definition changed, and the drift would be invisible - a role would simply stop
 * appearing on a domain nobody thought to update. Deriving it means adding a step
 * to a process automatically makes that role available in that area.
 *
 * The persona's own `gxpAreas` is merged in as well, because it also reflects
 * training scope: someone qualified in GLP should be selectable there even
 * before a process happens to reference them.
 */
/**
 * Which roles a domain involves, used to decide who may be entered as there.
 *
 * TWO PASSES, AND WHY
 * -------------------
 * A single pass over "every process tagged with this area" produced a useless
 * list: CAPA, deviation, change control and supplier audit are tagged with four
 * or five areas each, so 17 of 20 roles came out as "GVP roles" and the
 * domain-scoped entry the whole screen exists for was decoration.
 *
 * So the first pass takes only the area's OWN processes - the ones that belong to
 * one area or a small set - and the second pass adds the genuinely cross-cutting
 * functions that a domain cannot exclude: QA, internal audit, the qualified
 * person and training. Those roles are not intruders in GLP; a GLP site with no QA
 * presence is not a GLP site.
 *
 * Areas with no dedicated process of their own (GAMP, data integrity) therefore
 * fall back to the cross-cutting functions, which is the honest answer: nobody
 * "works in GAMP", they work in a domain and validate its systems.
 */
function rolesByArea() {
  const out = {};
  const counts = {};

  // ---- pass 1: the area's own processes ------------------------------------
  try {
    for (const row of db.all('SELECT gxp_areas, definitions_json FROM process_types WHERE active = 1')) {
      let areas = [];
      try { areas = JSON.parse(row.gxp_areas || '[]'); } catch { areas = []; }
      let def = {};
      try { def = JSON.parse(row.definitions_json || '{}'); } catch { def = {}; }
      if (areas.length > 3) continue;   // a general process, not this area's own
      for (const step of def.steps || []) {
        const roles = Array.isArray(step.role) ? step.role : (step.role ? [step.role] : []);
        for (const area of areas) {
          if (!out[area]) { out[area] = new Set(); counts[area] = {}; }
          for (const role of roles) {
            out[area].add(role);
            counts[area][role] = (counts[area][role] || 0) + 1;
          }
        }
      }
    }
  } catch { /* configuration not loaded yet */ }

  // ---- functions every domain has to include --------------------------------
  // EXPLICIT, NOT DERIVED, AND THAT IS DELIBERATE.
  //
  // The first attempt derived this: any role appearing in a general process
  // (CAPA, deviation, change control, supplier audit) was treated as
  // cross-cutting and added to every area that process touched. That was wrong,
  // and wrong in a way worth recording - CAPA's steps include the production
  // operator who raises the problem, so a pure derivation concluded that a
  // production operator belongs in GCP. He does not. The heuristic could not tell
  // "a role that oversees the quality system" from "a role that appears in a
  // process which happens to span the quality system".
  //
  // So the list is written out. Each entry is a function a GxP site cannot run
  // without in ANY area, and the reason is stated so the list can be argued with
  // rather than trusted blindly.
  const CROSS_CUTTING = {
    qa_manager: '质量体系覆盖全部领域——没有 QA 的领域就不构成 GxP 体系',
    qa_specialist: '执行调查、文件与整改跟踪，服务于所有领域',
    qa_auditor: '内审范围必须覆盖全部 GxP 领域（EU GMP 第 9 章）',
    qp: '批放行涉及生产与流通，Annex 16 的职责不限于一个领域',
    trainer: '培训与资质对每个领域一致适用',
  };
  // Every area, including one with no dedicated process of its own: GAMP has no
  // flow of its own, but a validation engineer and a QA manager still work in it.
  const allAreas = new Set(Object.keys(out));
  try {
    for (const row of db.all('SELECT code FROM gxp_areas')) allAreas.add(row.code);
  } catch { /* areas table not present yet */ }
  for (const area of allAreas) if (!out[area]) out[area] = new Set();
  for (const role of Object.keys(CROSS_CUTTING)) {
    for (const area of allAreas) out[area].add(role);
  }

  // ---- what the accounts themselves declare --------------------------------
  // Deliberately NOT merged into the area lists. Most demonstration accounts
  // declare six to eight areas because they were created as generalists, and
  // unioning that in put every role back into every area - which is the problem
  // this function was rewritten to solve. The account's own declaration is still
  // used when RANKING a roster and when deciding what training applies; the
  // question of who belongs in an area is answered by the configuration alone.
  // The external inspector may examine any domain, and appears in no process
  // definition, so no derivation would ever place them.
  //
  // The system administrator is deliberately NOT added to the domains. They hold
  // no GxP process role at all - the kernel refuses to let an administrator be
  // the sole approver of any record - and listing them as an identity on a GCP
  // page would suggest they take part in clinical work. They reach the instance
  // through "sign in with another account", which is what they actually are: an
  // administrator, not a participant.
  for (const area of allAreas) out[area].add('auditor_external');

  const result = {};
  for (const [area, roles] of Object.entries(out)) result[area] = [...roles].sort();
  return result;
}

/**
 * Step counts per area per role, for ranking a domain's roster.
 *
 * Only processes that BELONG to the area count, not every process that mentions
 * it. A CAPA touches GLP; it is not a GLP process. Counting its steps made QA
 * outrank the study director on the GLP start screen, which is exactly backwards
 * for somebody who opened the application because they work in a laboratory.
 */
function areaStepCounts() {
  const counts = {};
  try {
    for (const row of db.all('SELECT gxp_areas, definitions_json FROM process_types WHERE active = 1')) {
      let areas = [];
      try { areas = JSON.parse(row.gxp_areas || '[]'); } catch { areas = []; }
      let def = {};
      try { def = JSON.parse(row.definitions_json || '{}'); } catch { def = {}; }
      if (areas.length > 3) continue;
      for (const step of def.steps || []) {
        const roles = Array.isArray(step.role) ? step.role : (step.role ? [step.role] : []);
        for (const area of areas) {
          if (!counts[area]) counts[area] = {};
          for (const role of roles) counts[area][role] = (counts[area][role] || 0) + 1;
        }
      }
    }
  } catch { /* not loaded */ }
  return counts;
}

/**
 * Functions defined across every area. Declared once and used both here and by
 * the domain rosters, so the two cannot disagree about who works everywhere.
 */
const CROSS_DOMAIN_ROLES = {
  qa_manager: '质量体系覆盖全部领域',
  qa_specialist: '执行调查、文件与整改跟踪，服务于所有领域',
  qa_auditor: '内审范围必须覆盖全部 GxP 领域（EU GMP 第 9 章）',
  qp: '批放行涉及生产与流通，Annex 16 的职责不限于一个领域',
  trainer: '培训与资质对每个领域一致适用',
  auditor_external: '外部检查员可检查任何领域',
};

/**
 * Where an identity reaches, which is what the start-up list groups by.
 *
 * Three answers, and the difference matters because it decides both how the list
 * is arranged and which interface the person lands in:
 *
 *   whole_system  A function defined across every area, or one that administers
 *                 the instance. Nobody "works in" these.
 *   domain        A function inside named areas. The person has already told the
 *                 system where they work by choosing who they are.
 *   none          No process role at all.
 *
 * @param {string} role
 * @param {string[]} homeAreas
 * @returns {'whole_system'|'domain'|'none'}
 */
function scopeOfRole(role, homeAreas = []) {
  if (role === 'system_admin') return 'whole_system';
  if (CROSS_DOMAIN_ROLES[role]) return 'whole_system';
  return homeAreas.length ? 'domain' : 'none';
}

/**
 * Which interface this identity should land in after signing in.
 *
 * A person who belongs to one area goes straight to that area's interface; asking
 * them to pick a domain would be asking a question they have already answered by
 * choosing who they are.
 *
 * Somebody who works in several areas lands in the one where they own the most
 * process steps - the area they would name if asked where they work - rather than
 * facing a chooser. The interface lets them move to the others and the card states
 * which those are, so nothing is hidden; but the first screen after signing in
 * should be their own work, not a menu.
 *
 * `whole_system` identities get the domain chooser, because for them the choice is
 * genuinely open: a QA manager really does have to decide which area they are
 * looking at before looking at it.
 *
 * @param {string} role
 * @param {string[]} homeAreas
 * @param {object} homeSteps  steps owned per area, used to rank
 */
function landingFor(role, homeAreas = [], homeSteps = {}) {
  const scope = scopeOfRole(role, homeAreas);
  if (scope === 'whole_system') return { view: 'domains', domain: null, areas: homeAreas };
  if (scope === 'domain' && homeAreas.length) {
    const ranked = homeAreas.slice().sort(
      (a, b) => (homeSteps[b] || 0) - (homeSteps[a] || 0) || a.localeCompare(b)
    );
    return {
      view: 'domain',
      // Ranked by real involvement, not alphabetically: a QC analyst in GMP, GLP
      // and GPP belongs in GMP first because that is where most of their steps are.
      domain: ranked[0],
      areas: ranked,
      others: ranked.slice(1),
    };
  }
  // No process role in any area - the administrator, an engineer without an area.
  // They need the chooser to get anywhere at all.
  return { view: 'domains', domain: null, areas: [] };
}

/**
 * The areas a role genuinely works IN, as opposed to the ones it merely touches.
 *
 * WHY THIS IS SEPARATE FROM rolesByArea
 * -------------------------------------
 * `rolesByArea` answers "which roles are involved somewhere in this area", which
 * includes every general process - CAPA, deviation, change control, supplier
 * audit - because those are tagged with four or five areas at once. That is the
 * right answer for a permission matrix and the wrong answer for deciding who
 * belongs in a domain's entry list: it made 17 of 20 roles "GVP roles" and turned
 * domain-scoped entry into decoration.
 *
 * This answers the narrower question: which area's OWN processes does the role
 * own a step in. Derived the same way, from the definitions that belong to one
 * area or a small set, so it cannot drift from the configuration.
 */
function homeAreasByRole() {
  const counts = areaStepCounts();
  const out = {};
  for (const [area, byRole] of Object.entries(counts)) {
    for (const [role, steps] of Object.entries(byRole)) {
      if (steps <= 0) continue;
      if (!out[role]) out[role] = {};
      out[role][area] = steps;
    }
  }
  return out;
}

/** The areas a start-up screen can offer, in display order. */
function loginDomains() {
  const areas = db.all(
    'SELECT code, name, name_en, full_name, full_name_en, description, colour, sort_order ' +
    'FROM gxp_areas ORDER BY sort_order, code'
  );
  const byArea = rolesByArea();
  // Login choices are computed once and reused: the count on a domain card and
  // the roster the domain screen offers must come from the SAME list, or the card
  // promises identities the screen then does not show. That mismatch existed -
  // GAMP advertised zero identities while offering three - because one side
  // filtered on homeAreas and the other on rolesByArea.
  const personas = loginChoices();
  return areas.map((a) => {
    const participants = (byArea[a.code] || []);
    let processCount = 0;
    try {
      processCount = db.all(
        'SELECT gxp_areas FROM process_types WHERE active = 1'
      ).filter((r) => {
        try { return JSON.parse(r.gxp_areas || '[]').includes(a.code); } catch { return false; }
      }).length;
    } catch { processCount = 0; }
    const roster = personas.filter((p) => participants.includes(p.role));
    return {
      code: a.code,
      name: a.name,
      nameEn: a.name_en,
      fullName: a.full_name,
      fullNameEn: a.full_name_en,
      description: a.description,
      colour: a.colour,
      processCount,
      participantRoles: participants,
      personaCount: roster.length,
      // Which accounts, so the domain screen can render the same list the card
      // counted rather than re-deriving it and risking a different answer.
      personaRoles: roster.map((p) => p.role),
    };
  });
}

/**
 * The list shown on the start-up screen.
 *
 * WHY THIS READS THE DATABASE RATHER THAN THE PERSONA CURATION
 * -----------------------------------------------------------
 * The PERSONAS array holds nine curated demonstration accounts, and for a while
 * this function returned exactly those nine. That was wrong: nineteen of the
 * twenty-eight accounts the demonstration data creates - the study director, the
 * laboratory technician, the principal investigator, the QP, the validation
 * engineer - could not be chosen at all, because they are seeded by
 * scripts/seed-demo.js rather than declared here. A GLP user opening the
 * application was offered a production operator.
 *
 * The list matters more now that it is the opening screen rather than a step
 * inside a domain: whatever it omits is not merely deprioritised, it is
 * unreachable.
 *
 * So the roster is every active account, enriched with the curated blurb where
 * one exists. Only exposed when built-in accounts are enabled, because publishing
 * usernames is only acceptable on a demonstration instance.
 *
 * @param {{withPending?: boolean}} opts  computing pending work is a query per
 *   account; the start-up screen does not need it, so it is opt-in.
 */
function loginChoices(opts = {}) {
  if (!builtinAccountsEnabled()) return [];
  const withPending = Boolean(opts.withPending);
  const byArea = rolesByArea();
  const stepCounts = areaStepCounts();
  const home = homeAreasByRole();
  const rbac = require('../core/rbac');
  const personaByName = new Map(PERSONAS.map((p) => [p.username, p]));

  let rows = [];
  try {
    rows = db.all(
      "SELECT id, username, full_name, full_name_en, role, department, job_title, gxp_areas " +
      "FROM users WHERE status = 'active' ORDER BY username"
    );
  } catch { return []; }

  // One entry per human.
  //
  // This used to collapse accounts by role: two accounts often exist for the
  // same role - the curated demonstration persona (demo.qamanager, written with a
  // blurb that explains the role's point) and a plainer account created by the
  // demo dataset (qa.manager) - and collapsing them kept the list short.
  //
  // Collapsing was wrong once an administrator could create accounts, and the
  // cost was invisible: a freshly created second QC analyst shared a role with
  // the seeded demo.qc, so the dedupe picked the curated account and simply
  // removed the new employee from the identity list. "I added a person and they
  // never appeared" is exactly the failure the start-up screen must not have.
  // Every active account is a card now. Where two accounts share a role, the
  // curated one sorts first and carries the explanation; the other appears with
  // its own name, which is the correct answer to "who can I sign in as".
  const available = [];
  for (const row of rows) {
    const curated = personaByName.has(row.username);
    const persona = personaByName.get(row.username) || null;
    const roleDef = rbac.ROLES[row.role] || { label: row.role, labelZh: row.role };

    // The areas this account can be offered for: its role's process involvement,
    const areas = new Set();
    let declared = [];
    try { declared = JSON.parse(row.gxp_areas || '[]'); } catch { declared = []; }
    for (const a of declared) areas.add(a);
    // Also any area where this role owns a step of a process. Without this the
    // seeded accounts whose gxp_areas is empty - the principal investigator, for
    // instance - would be offered nowhere at all.
    for (const [area, roles] of Object.entries(byArea)) {
      if (roles.includes(row.role)) areas.add(area);
    }

    let pending = 0;
    if (withPending) {
      try { pending = require('./inbox').build(row, { limit: 1 }).counts.total; } catch { pending = 0; }
    }

    const areaSteps = {};
    for (const a of areas) areaSteps[a] = (stepCounts[a] || {})[row.role] || 0;

    // The areas this role works in rather than touches, computed once here so the
    // scope, the landing destination and the export all read the same value.
    const homeAreas = Object.keys(home[row.role] || {}).sort();

    // Where the person themselves says they work, if they said anything. A brand
    // new QC analyst who was created with gxp_areas ['GMP'] should land in GMP on
    // sign-in, not in the role's heaviest area by process weight - the declared
    // scope is the human speaking, and it wins. An account with no declaration
    // (the seeded personas) falls back to the role's home areas unchanged.
    const landingAreas = (() => {
      if (!declared.length) return homeAreas;
      const inArea = homeAreas.filter((a) => declared.includes(a));
      return inArea.length ? inArea : homeAreas;
    })();

    available.push({
      username: row.username,
      fullName: row.full_name,
      fullNameEn: row.full_name_en,
      role: row.role,
      roleLabel: roleDef.label,
      roleLabelZh: roleDef.labelZh,
      department: row.department || (persona ? persona.department : ''),
      jobTitle: row.job_title || (persona ? persona.jobTitle : ''),
      // Curated persona copy first, then the role's own blurb, then the
      // generic RBAC description. A card that says only "QA Specialist" is
      // informative but flat, and it sits beside cards that explain themselves.
      blurb: persona ? persona.blurb
        : (ROLE_BLURBS[row.role] ? ROLE_BLURBS[row.role].zh : (roleDef.description || '')),
      blurbEn: persona ? persona.blurbEn
        : (ROLE_BLURBS[row.role] ? ROLE_BLURBS[row.role].en : (roleDef.description || '')),
      highlight: persona ? persona.highlight
        : (ROLE_BLURBS[row.role] ? ROLE_BLURBS[row.role].highlight : null),
      pendingItems: pending,
      gxpAreas: [...areas].sort(),
      // How many steps this role owns in each area it appears in, so the
      // start-up screen can rank a domain's roster by real involvement instead
      // of showing an alphabetical wall.
      areaSteps,
      // The areas this role works IN, not the ones it merely touches. The identity
      // list for a domain is filtered on this; `gxpAreas` stays broad because the
      // permission matrix genuinely concerns every area a role is involved in.
      homeAreas,
      homeSteps: home[row.role] || {},
      // Where this identity reaches, which is what the start-up list is
      // grouped by and what decides the interface it lands in.
      scope: scopeOfRole(row.role, homeAreas),
      landing: landingFor(row.role, landingAreas, home[row.role] || {}),
      // Whether this account carries a curated demonstration narrative, so the
      // screen can mark the ones written to teach something specific.
      curated: curated || Boolean(ROLE_BLURBS[row.role]),
    });
  }
  return available;
}

function passwordHint() {
  return builtinAccountsEnabled() ? BUILTIN_PASSWORD : null;
}

/**
 * Every credential a demonstration account might have been created with.
 *
 * The shared password was once written as two literals in two files -
 * 'GxP-Demo-2026!' for the curated personas and 'Demo-GxP-2026!' for the demo
 * dataset, the same words reversed. An instance seeded before that was unified
 * still holds the old value for half its accounts, and the start-up screen would
 * offer an identity that cannot be signed in as. Publishing both lets the screen
 * fall back instead of failing in front of a user.
 *
 * The first entry is the current password and is the only one shown in the UI.
 */
function passwordCandidates() {
  if (!builtinAccountsEnabled()) return [];
  const legacy = 'Demo-GxP-2026!';
  return legacy === BUILTIN_PASSWORD ? [BUILTIN_PASSWORD] : [BUILTIN_PASSWORD, legacy];
}

module.exports = {
  PERSONAS,
  BUILTIN_PASSWORD,
  builtinAccountsEnabled,
  provision,
  loginChoices,
  loginDomains,
  rolesByArea,
  areaStepCounts,
  homeAreasByRole,
  passwordHint,
  passwordCandidates,
  ensurePersona,
};
