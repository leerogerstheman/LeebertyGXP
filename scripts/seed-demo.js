'use strict';

/**
 * Demo / training dataset generator.
 *
 *   node scripts/seed-demo.js                 populate an empty instance
 *   node scripts/seed-demo.js --force         allow adding to a populated instance
 *   node scripts/seed-demo.js --dry-run       report what would be created
 *
 * WHY THIS IS NOT PART OF seed.js
 * -------------------------------
 * Checklist templates and process definitions are *configuration*: they must be
 * present in every instance, including production. This file creates
 * *fictional GxP records* - deviations, CAPAs, signatures, batch numbers. In a
 * real instance those would pollute the audit trail with fabricated events and
 * destroy the evidential value of the ledger. So demo data lives here and is
 * never loaded automatically.
 *
 * The script also refuses to touch an instance that already contains quality
 * records unless --force is given, and it marks every record it creates through
 * the summary text so the data is identifiable as fictional.
 *
 * Every record is created through the real domain services, so the demo
 * exercises exactly the same code paths as production use: signatures are
 * applied through auth.sign(), steps advance through workflow.completeStep()
 * with the role gates actually enforced, and the audit chain grows the same way
 * it would with real work.
 */

const path = require('node:path');
const config = require('../src/config');
const db = require('../src/core/db');
const audit = require('../src/core/audit');
const auth = require('../src/core/auth');
const workflow = require('../src/domain/workflow');
const documents = require('../src/domain/documents');
const inspections = require('../src/domain/inspections');
const training = require('../src/domain/training');
const equipment = require('../src/domain/equipment');

const MARKER = '[演示数据 DEMO]';

// One password for every demonstration account.
//
// This was its own literal ('Demo-GxP-2026!') while the built-in personas used
// 'GxP-Demo-2026!' - the same words in a different order. The start-up screen
// publishes a single shared credential, so every account created here could not
// be logged into from the screen that offered it: eleven of them, including the
// study director, the principal investigator and the QP. Reading the constant
// from the accounts module makes that divergence impossible rather than merely
// fixed once.
const DEMO_PASSWORD = require('../src/domain/accounts').BUILTIN_PASSWORD;

const ctx = { ip: '127.0.0.1', userAgent: 'seed-demo/1.0', sessionId: null };

/**
 * Apply a real electronic signature as a given user.
 *
 * Every signature in this dataset is produced through auth.sign(), so the demo
 * exercises the actual signing path: component A is the username plus password,
 * and component B is a fresh single-use server challenge. That two-component
 * requirement (21 CFR Part 11.200(a)(1)(i)) is deliberately not bypassed here -
 * if it were, the demo would misrepresent how signing works, and passing only a
 * password is refused by the kernel with SECOND_FACTOR_REQUIRED.
 */
function signAs(user, entityType, entityId, recordKey, meaning, reason, stepCode) {
  const session = auth.createSession(user, ctx);
  const challenge = auth.issueSigningNonce(user, session, meaning);
  const result = auth.sign({
    user, session,
    username: user.username, password: DEMO_PASSWORD,
    nonce: challenge.nonce,
    meaning, reason: `${MARKER} ${reason}`,
    entityType, entityId, recordKey, stepCode,
    ctx,
  });
  if (!result.ok) {
    throw new Error(`electronic signature failed for ${user.username}: ${result.code}`);
  }
  return result.signature.id;
}

function parseArgs(argv) {
  const args = { force: false, dryRun: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function log(message) { process.stdout.write(`  ${message}\n`); }

/** Days ago, as an ISO date-time. Used to spread records over recent months. */
function daysAgo(days, hour = 9) {
  const d = new Date(Date.now() - days * 86400000);
  d.setHours(hour, Math.floor((days * 7) % 60), 0, 0);
  return d.toISOString();
}

function dateAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function dateAhead(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ users ---

function createUser({ username, fullName, fullNameEn, role, department, jobTitle, gxpAreas, qualification }) {
  const existing = auth.getUserByUsername(username);
  if (existing) return auth.getUserById(existing.id);
  const at = new Date().toISOString();
  let id;
  db.transaction(() => {
    db.run(
      'INSERT INTO users (username, full_name, full_name_en, email, employee_no, department, job_title, role, ' +
      'status, locale, gxp_areas, qualification, must_change_password, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [username, fullName, fullNameEn || null, `${username}@demo.example`, `EMP-${1000 + Math.floor(Math.random() * 8999)}`,
        department, jobTitle, role, 'active', 'zh-CN', JSON.stringify(gxpAreas || []),
        JSON.stringify(qualification || {}), 0, at, at]
    );
    id = db.get('SELECT last_insert_rowid() AS id').id;
  });
  const user = auth.getUserById(id);
  auth.setPassword(id, DEMO_PASSWORD, user, ctx, { mustChange: false, reason: `${MARKER} demo account created` });
  return auth.getUserById(id);
}

const PEOPLE = [
  { username: 'qa.manager', fullName: '李静', fullNameEn: 'Li Jing', role: 'qa_manager', department: '质量保证部', jobTitle: 'QA 负责人', gxpAreas: ['GMP', 'GLP', 'GDPR-DataIntegrity'], qualification: { GMP: true, GLP: true } },
  { username: 'qa.specialist', fullName: '王涛', fullNameEn: 'Wang Tao', role: 'qa_specialist', department: '质量保证部', jobTitle: 'QA 专员', gxpAreas: ['GMP', 'GDPR-DataIntegrity'], qualification: { GMP: true } },
  { username: 'qa.auditor', fullName: '陈敏', fullNameEn: 'Chen Min', role: 'qa_auditor', department: '质量保证部', jobTitle: '内审员', gxpAreas: ['GMP', 'GLP'], qualification: { GMP: true, GLP: true } },
  { username: 'prod.manager', fullName: '赵国强', fullNameEn: 'Zhao Guoqiang', role: 'production_manager', department: '生产部', jobTitle: '生产负责人', gxpAreas: ['GMP'], qualification: { GMP: true } },
  { username: 'prod.operator', fullName: '刘洋', fullNameEn: 'Liu Yang', role: 'production_operator', department: '生产部', jobTitle: '压片操作工', gxpAreas: ['GMP'], qualification: { GMP: true } },
  { username: 'qc.manager', fullName: '孙丽华', fullNameEn: 'Sun Lihua', role: 'qc_manager', department: '质量控制部', jobTitle: 'QC 负责人', gxpAreas: ['GMP', 'GLP'], qualification: { GMP: true, GLP: true } },
  { username: 'qc.analyst', fullName: '周晓峰', fullNameEn: 'Zhou Xiaofeng', role: 'qc_analyst', department: '质量控制部', jobTitle: 'QC 分析员', gxpAreas: ['GMP'], qualification: { GMP: true } },
  { username: 'warehouse.keeper', fullName: '吴建平', fullNameEn: 'Wu Jianping', role: 'warehouse_keeper', department: '仓储物流部', jobTitle: '仓储主管', gxpAreas: ['GDP'], qualification: { GDP: true } },
  { username: 'engineering', fullName: '郑海涛', fullNameEn: 'Zheng Haitao', role: 'engineering', department: '工程部', jobTitle: '设备工程师', gxpAreas: ['GMP', 'GAMP'], qualification: { GMP: true } },
  { username: 'trainer', fullName: '黄燕', fullNameEn: 'Huang Yan', role: 'trainer', department: '人力资源部', jobTitle: '培训协调员', gxpAreas: ['GMP', 'GLP', 'GCP'] },
  // --- roles that only the non-GMP domains exercise -------------------------
  // Without these, GLP, GCP, GVP and GPP records would have to be driven by
  // actors whose role the step gates do not accept, and the demonstration would
  // have to bypass the kernel's own separation-of-duties checks.
  { username: 'lab.manager', fullName: '沈国华', fullNameEn: 'Shen Guohua', role: 'lab_manager', department: '非临床研究中心', jobTitle: '专题负责人', gxpAreas: ['GLP'], qualification: { GLP: true } },
  { username: 'lab.tech', fullName: '何丽', fullNameEn: 'He Li', role: 'lab_technician', department: '非临床研究中心', jobTitle: '实验技术员', gxpAreas: ['GLP'], qualification: { GLP: true } },
  { username: 'clinical.pi', fullName: '许文明', fullNameEn: 'Xu Wenming', role: 'clinical_pi', department: '临床研究中心', jobTitle: '主要研究者', gxpAreas: ['GCP'], qualification: { GCP: true } },
  { username: 'clinical.cra', fullName: '田悦', fullNameEn: 'Tian Yue', role: 'clinical_monitor', department: '临床运营部', jobTitle: '临床监查员', gxpAreas: ['GCP'], qualification: { GCP: true } },
  { username: 'pv.officer', fullName: '范晓东', fullNameEn: 'Fan Xiaodong', role: 'pharmacovigilance', department: '药物警戒部', jobTitle: '药物警戒专员', gxpAreas: ['GVP', 'GCP'], qualification: { GVP: true } },
  // The last three roles that a process definition names. Each needs an account,
  // because the workflow diagram makes participant cards clickable: a card whose
  // role has no account cannot be opened, and the roles that would be missing are
  // precisely the ones holding approval authority - QP batch release, regulatory
  // impact assessment and CSV validation.
  { username: 'qp', fullName: '邱志远', fullNameEn: 'Qiu Zhiyuan', role: 'qp', department: '质量保证部', jobTitle: '质量受权人', gxpAreas: ['GMP', 'GDP'], qualification: { GMP: true, GDP: true } },
  { username: 'ra.officer', fullName: '崔文婷', fullNameEn: 'Cui Wenting', role: 'ra_officer', department: '注册事务部', jobTitle: '注册事务专员', gxpAreas: ['GMP', 'GCP', 'GVP'], qualification: { GMP: true, GCP: true } },
  { username: 'validation.eng', fullName: '范建军', fullNameEn: 'Fan Jianjun', role: 'validation_engineer', department: '工程部', jobTitle: '验证工程师', gxpAreas: ['GAMP', 'GMP'], qualification: { GMP: true } },
];

// ------------------------------------------------------------- curricula ----

const CURRICULA = [
  {
    code: 'GMP-BASIC', title: 'GMP 基础培训', titleEn: 'GMP Foundation',
    gxpAreas: ['GMP'], appliesToRoles: ['production_operator', 'production_manager', 'warehouse_keeper', 'engineering', 'qc_analyst'],
    validityMonths: 24, isGxpCritical: true,
    description: '药品生产质量管理规范基础要求、人员卫生、记录填写规范、污染与交叉污染防控。',
  },
  {
    code: 'DI-ALCOA', title: '数据完整性培训（ALCOA+）', titleEn: 'Data Integrity (ALCOA+)',
    gxpAreas: ['GDPR-DataIntegrity', 'GMP', 'GLP'], appliesToRoles: ['production_operator', 'qc_analyst', 'qa_specialist', 'qa_manager', 'qc_manager', 'production_manager', 'engineering', 'qa_auditor'],
    validityMonths: 12, isGxpCritical: true,
    description: 'ALCOA+ 九项原则、禁止行为、原始数据定义、审计追踪的含义与查阅、错误报告渠道。全员必修。',
  },
  {
    code: 'DEV-CAPA', title: '偏差处理与 CAPA', titleEn: 'Deviation Handling & CAPA',
    gxpAreas: ['GMP'], appliesToRoles: ['qa_specialist', 'qa_manager', 'production_manager', 'qc_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: '偏差的识别与报告、根本原因分析方法、影响评估范围、CAPA 制定与有效性检查。',
  },
  {
    code: 'OOS-INV', title: 'OOS/OOT 调查', titleEn: 'OOS/OOT Investigation',
    gxpAreas: ['GMP'], appliesToRoles: ['qc_analyst', 'qc_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: '阶段一实验室调查与阶段二全面调查的界限、复测方案的前置设定、批次处置原则。',
  },
  {
    code: 'CSV-PART11', title: '计算机化系统与 21 CFR Part 11', titleEn: 'Computerised Systems & 21 CFR Part 11',
    gxpAreas: ['GAMP'], appliesToRoles: ['qa_manager', 'qa_specialist', 'engineering', 'qc_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: 'Annex 11 与 Part 11 要求、权限管理、审计追踪核查、电子签名的两个识别要素。',
  },
  {
    code: 'SELF-INSPECT', title: '自检与检查应对', titleEn: 'Self-Inspection & Inspection Readiness',
    gxpAreas: ['GMP'], appliesToRoles: ['qa_auditor', 'qa_manager', 'qa_specialist'],
    validityMonths: 12, isGxpCritical: false,
    description: '自检计划与执行、缺陷分级、检查前准备、检查员访谈应对技巧。',
  },
  {
    code: 'GDP-STORAGE', title: '药品储运与冷链管理', titleEn: 'GDP Storage & Cold Chain',
    gxpAreas: ['GDP'], appliesToRoles: ['warehouse_keeper'],
    validityMonths: 24, isGxpCritical: true,
    description: '储存条件、温度监测、收货检查、退货处置、召回执行。',
  },
  {
    code: 'GLP-STUDY', title: 'GLP 研究实施与原始数据', titleEn: 'GLP Study Conduct & Raw Data',
    gxpAreas: ['GLP'], appliesToRoles: ['qa_auditor', 'qc_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: 'GLP 原则、专题负责人的职责、QA 独立性、原始数据的记录与归档要求。',
  },
];

// ------------------------------------------------------------------ docs ----

const DOCUMENTS = [
  { docNumber: 'SOP-QA-001', title: '数据完整性管理规程', titleEn: 'Data Integrity Management Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GMP', 'GDPR-DataIntegrity'], summary: '规定原始数据的定义、记录填写与修改要求、审计追踪的查阅与审核、禁止行为清单及报告渠道。' },
  { docNumber: 'SOP-QA-002', title: '偏差处理规程', titleEn: 'Deviation Handling Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '偏差的分级标准、报告时限、调查方法、影响评估范围、CAPA 判定与有效性检查要求。' },
  { docNumber: 'SOP-QA-003', title: '变更控制管理规程', titleEn: 'Change Control Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '变更的分类、影响评估（质量/验证/注册/CSV/EHS）、批准权限、实施与验证、关闭要求。' },
  { docNumber: 'SOP-QC-010', title: '超标结果（OOS）调查规程', titleEn: 'Out-of-Specification Investigation Procedure', docType: 'sop', department: '质量控制部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '阶段一实验室调查与阶段二全面调查的执行要求、复测与重新取样的前置条件、批次处置原则。' },
  { docNumber: 'SOP-QC-011', title: '高效液相色谱法检验操作规程', titleEn: 'HPLC Testing Procedure', docType: 'test_method', department: '质量控制部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '含量与有关物质测定的操作步骤、系统适用性要求、试针与积分参数管理、原始数据保存要求。' },
  { docNumber: 'SOP-QC-012', title: '检验仪器校准与期间核查规程', titleEn: 'Analytical Instrument Calibration Procedure', docType: 'sop', department: '质量控制部', reviewPeriodMonths: 36, gxpAreas: ['GMP'], summary: '仪器校准周期、校准标准溯源要求、超期未校准仪器的处置、期间核查方法。' },
  { docNumber: 'SOP-PR-020', title: '压片工序操作规程', titleEn: 'Tablet Compression Procedure', docType: 'sop', department: '生产部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '压片机参数设定、片重与硬度控制、过程控制取样频次、异常停机处理。' },
  { docNumber: 'SOP-PR-021', title: '清洁验证管理规程', titleEn: 'Cleaning Validation Procedure', docType: 'validation_protocol', department: '生产部', reviewPeriodMonths: 36, gxpAreas: ['GMP'], summary: '最差条件产品选择、残留限度计算依据（千分之一日治疗剂量与 10 ppm 双标准）、取样方法与接受标准。' },
  { docNumber: 'SOP-QA-004', title: '自检管理规程', titleEn: 'Self-Inspection Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GMP'], summary: '自检的年度计划、覆盖范围、自检员资质与独立性要求、缺陷分级与整改跟踪、管理评审输入。' },
  { docNumber: 'SOP-WH-030', title: '药品收货与验收规程', titleEn: 'Goods Receipt and Acceptance Procedure', docType: 'sop', department: '仓储物流部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '收货核对项目、冷链药品温度记录审核、待验区管理、拒收与偏差处理。' },
  { docNumber: 'SPEC-001', title: 'XX 片成品质量标准', titleEn: 'Finished Product Specification - XX Tablets', docType: 'specification', department: '质量控制部', reviewPeriodMonths: 36, gxpAreas: ['GMP'], summary: '性状、鉴别、含量、有关物质、溶出度、微生物限度的接受标准与检验方法索引。' },
  { docNumber: 'SOP-QA-005', title: '记录填写与更正管理规程', titleEn: 'Record Completion and Correction Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GMP', 'GDPR-DataIntegrity'], summary: '使用不褪色墨水、及时填写、单线划改并签名注明日期与理由、禁止涂改与代签。' },
];

// ------------------------------------------------------------- equipment ----

const EQUIPMENT = [
  { assetNo: 'HPLC-001', name: '高效液相色谱仪', nameEn: 'HPLC System', model: 'Agilent 1260', manufacturer: 'Agilent', location: 'QC 实验室 1', department: '质量控制部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-HPLC-001' },
  { assetNo: 'HPLC-002', name: '高效液相色谱仪', nameEn: 'HPLC System', model: 'Waters Arc', manufacturer: 'Waters', location: 'QC 实验室 1', department: '质量控制部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-HPLC-002' },
  { assetNo: 'BAL-001', name: '万分之一分析天平', nameEn: 'Analytical Balance', model: 'Mettler XS205', manufacturer: 'Mettler Toledo', location: 'QC 实验室 1', department: '质量控制部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 180, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'TAB-001', name: '旋转压片机', nameEn: 'Rotary Tablet Press', model: 'FETTE 2090', manufacturer: 'FETTE', location: '固体制剂车间 A', department: '生产部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 90, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'TAB-002', name: '旋转压片机', nameEn: 'Rotary Tablet Press', model: 'FETTE 2090', manufacturer: 'FETTE', location: '固体制剂车间 B', department: '生产部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 90, qualificationStatus: 'in_progress', csvStatus: 'not_applicable' },
  { assetNo: 'DIS-001', name: '溶出度试验仪', nameEn: 'Dissolution Tester', model: 'SOTAX AT7', manufacturer: 'SOTAX', location: 'QC 实验室 2', department: '质量控制部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'HVAC-AHU-01', name: '固体制剂车间空调机组', nameEn: 'AHU - Solid Dosage Workshop', model: 'AHU-5000', manufacturer: '天加', location: '固体制剂车间 A', department: '工程部', gxpAreas: ['GMP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 90, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'COLD-001', name: '冷藏库（2-8℃）', nameEn: 'Cold Room (2-8 C)', model: 'CR-20', manufacturer: '海尔生物医疗', location: '仓储中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'TEMP-LOG-01', name: '温湿度自动监测系统', nameEn: 'Temperature Monitoring System', model: 'TempTrak', manufacturer: 'Thermo Fisher', location: '仓储中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-TMS-001' },
  { assetNo: 'HARD-001', name: '片剂硬度测试仪', nameEn: 'Tablet Hardness Tester', model: 'Copley TBF200', manufacturer: 'Copley', location: '固体制剂车间 A', department: '生产部', gxpAreas: ['GMP'], criticality: 'major', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
];

// ------------------------------------------------------------------- run ----

function countExistingBusinessRecords() {
  return db.get('SELECT COUNT(*) AS n FROM workflow_instances').n;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write([
      '',
      '  Populate a GxP Workbench instance with a realistic demonstration scenario.',
      '',
      '  Usage:',
      '    node scripts/seed-demo.js              populate an empty instance',
      '    node scripts/seed-demo.js --force      also add to an instance with existing records',
      '    node scripts/seed-demo.js --dry-run    report what would be created, change nothing',
      '',
      `  Every account created uses the password:  ${DEMO_PASSWORD}`,
      '',
    ].join('\n'));
    process.exit(0);
  }

  db.open();

  process.stdout.write('\n  LeebertyGXP - demonstration dataset\n');
  process.stdout.write(`  ${'='.repeat(64)}\n\n`);
  process.stdout.write('  This creates FICTIONAL GxP records (deviations, CAPAs, OOS,\n');
  process.stdout.write('  signatures, batches) written to the real audit trail.\n');
  process.stdout.write('  NEVER run this against a production instance.\n\n');

  const existing = countExistingBusinessRecords();
  if (existing > 0 && !args.force) {
    process.stdout.write(`  Refusing to run: this instance already holds ${existing} quality record(s).\n`);
    process.stdout.write('  Re-run with --force only if you are certain this is a demo instance.\n\n');
    process.exit(1);
  }

  if (args.dryRun) {
    log(`would create ${PEOPLE.length} users`);
    log(`would create ${CURRICULA.length} training curricula`);
    log(`would create ${DOCUMENTS.length} controlled documents`);
    log(`would create ${EQUIPMENT.length} equipment records`);
    log('would create 6 deviations, 2 CAPAs, 2 OOS investigations, 1 change control');
    log('would create 1 self-inspection with assessed findings and 1 linked CAPA');
    log('would set up 1 overdue and 1 expiring training record');
    process.stdout.write('\n  Dry run complete. Nothing was written.\n\n');
    db.close();
    process.exit(0);
  }

  const started = Date.now();

  // ---- people -------------------------------------------------------------
  const U = {};
  for (const person of PEOPLE) {
    U[person.username] = createUser(person);
  }
  // The administrator created during first-run setup acts as the system owner.
  // If nobody has completed setup yet, create one here so the demo can be
  // generated without a detour through the browser.
  let admin = db.get("SELECT * FROM users WHERE role = 'system_admin' AND status = 'active' ORDER BY id LIMIT 1");
  let adminCreated = false;
  if (!admin) {
    U['admin'] = createUser({
      username: 'admin', fullName: '系统负责人', fullNameEn: 'System Owner',
      role: 'system_admin', department: '质量保证部', jobTitle: '系统管理员',
      gxpAreas: ['GMP', 'GAMP', 'GDPR-DataIntegrity'],
    });
    admin = auth.getUserById(U['admin'].id);
    adminCreated = true;
  }
  log(`users              ${PEOPLE.length + (adminCreated ? 1 : 0)} created/updated (password: ${DEMO_PASSWORD})`);
  if (adminCreated) {
    log('                   administrator "admin" created because none existed');
  }

  // ---- curricula and training records -------------------------------------
  const curricula = {};
  for (const c of CURRICULA) {
    curricula[c.code] = training.createCurriculum({
      code: c.code, title: c.title, titleEn: c.titleEn, gxpAreas: c.gxpAreas,
      appliesToRoles: c.appliesToRoles, validityMonths: c.validityMonths,
      isGxpCritical: c.isGxpCritical, description: c.description,
    }, U['qa.manager'], ctx);
  }
  log(`curricula          ${CURRICULA.length} created`);

  /**
   * Assign and then complete a training record through the domain service, so
   * the completion flows through the same signature gate and audit path as real
   * use (a real electronic signature is applied by the trainer).
   */
  function assignAndComplete(curriculumCode, username, daysAgoDone, opts = {}) {
    const cur = curricula[curriculumCode];
    const user = U[username];
    training.assign(cur.id, { userIds: [user.id], dueDate: dateAgo(Math.max(1, daysAgoDone - 20)) }, U['trainer'], ctx);
    const rec = db.get(
      'SELECT * FROM training_records WHERE curriculum_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
      [cur.id, user.id]
    );
    // GxP-critical curricula cannot be completed without a signed record, so the
    // trainer signs the completion exactly as they would in real use.
    const signatureId = signAs(
      U['trainer'], 'training_records', rec.id, `training:${rec.id}`, 'completed',
      `确认 ${user.full_name} 已完成《${cur.title}》培训并通过考核`, null
    );
    training.recordCompletion(rec.id, {
      status: 'completed',
      method: opts.method || 'classroom',
      score: opts.score != null ? opts.score : 92,
      passMark: opts.passMark != null ? opts.passMark : 80,
      result: 'pass',
      trainerName: U['trainer'].full_name,
      trainedBy: U['trainer'].id,
      completedAt: daysAgo(daysAgoDone, 14),
      validityMonths: CURRICULA.find((x) => x.code === curriculumCode).validityMonths,
      evidence: `${MARKER} 培训记录与考核卷归档于培训档案`,
      notes: `${MARKER} 演示培训记录`,
      signatureId,
    }, U['trainer'], ctx);
    return rec.id;
  }

  // A realistic spread: most people current, a few with real gaps.
  assignAndComplete('DI-ALCOA', 'prod.operator', 200);
  assignAndComplete('GMP-BASIC', 'prod.operator', 180);
  assignAndComplete('DI-ALCOA', 'qc.analyst', 150);
  assignAndComplete('OOS-INV', 'qc.analyst', 140);
  assignAndComplete('GMP-BASIC', 'qc.analyst', 300);
  assignAndComplete('DI-ALCOA', 'qa.specialist', 120);
  assignAndComplete('DEV-CAPA', 'qa.specialist', 100);
  assignAndComplete('DI-ALCOA', 'qa.manager', 60);
  assignAndComplete('DEV-CAPA', 'qa.manager', 60);
  assignAndComplete('CSV-PART11', 'qa.manager', 90);
  assignAndComplete('SELF-INSPECT', 'qa.auditor', 45);
  assignAndComplete('GLP-STUDY', 'qa.auditor', 75);
  assignAndComplete('GMP-BASIC', 'prod.manager', 240);
  assignAndComplete('DEV-CAPA', 'prod.manager', 130);
  assignAndComplete('DI-ALCOA', 'prod.manager', 110);
  assignAndComplete('OOS-INV', 'qc.manager', 160);
  assignAndComplete('DI-ALCOA', 'qc.manager', 95);
  assignAndComplete('CSV-PART11', 'qc.manager', 85);
  assignAndComplete('GDP-STORAGE', 'warehouse.keeper', 30);   // expiring soon (24-month validity would not be; force 12)
  assignAndComplete('DI-ALCOA', 'engineering', 20);
  assignAndComplete('CSV-PART11', 'engineering', 55);
  assignAndComplete('GMP-BASIC', 'engineering', 210);

  // Deliberate gaps so the dashboard has something real to report.
  // 1. An overdue assignment nobody has completed.
  training.assign(curricula['DI-ALCOA'].id, { userIds: [U['warehouse.keeper'].id], dueDate: dateAgo(12) }, U['trainer'], ctx);
  // 2. A required curriculum never assigned to a person who needs it.
  training.assign(curricula['GMP-BASIC'].id, { userIds: [U['warehouse.keeper'].id], dueDate: dateAhead(20) }, U['trainer'], ctx);
  // 3. An expired record: backdate a completion so it falls outside validity.
  const expiredRec = db.get(
    'SELECT tr.id FROM training_records tr JOIN training_curricula c ON c.id = tr.curriculum_id ' +
    "WHERE c.code = 'GMP-BASIC' AND tr.user_id = ? AND tr.status = 'completed'",
    [U['prod.operator'].id]
  );
  if (expiredRec) {
    db.run('UPDATE training_records SET expires_at = ? WHERE id = ?', [dateAgo(25), expiredRec.id]);
  }
  log(`training records   ${db.get('SELECT COUNT(*) AS n FROM training_records').n} created (含超期与即将到期案例)`);

  // ---- controlled documents ----------------------------------------------
  const docs = {};
  for (const d of DOCUMENTS) {
    docs[d.docNumber] = documents.createDocument({
      docNumber: d.docNumber, title: d.title, titleEn: d.titleEn, docType: d.docType,
      department: d.department, reviewPeriodMonths: d.reviewPeriodMonths,
      gxpAreas: d.gxpAreas, summary: d.summary, retentionYears: 10,
      changeReason: `${MARKER} 建立演示用受控文件`,
      changeSummary: '初始发布',
    }, U['qa.manager'], ctx);
  }

  // Take most documents through to effective, leaving two deliberately behind so
  // the "stale draft" and "awaiting review" indicators have real content.
  const toRelease = Object.entries(docs).filter(([num]) => !['SOP-WH-030', 'SOP-QA-005'].includes(num));
  for (const [num, doc] of toRelease) {
    const version = doc.versions[0].version;
    documents.transitionVersion(doc.id, version, 'in_review',
      { reason: `${MARKER} 提交审核` }, U['qa.specialist'], ctx);
    documents.transitionVersion(doc.id, version, 'approved',
      { reason: `${MARKER} 审核通过`, signatureId: signAs(U['qa.manager'], 'documents', doc.id, `doc:${num}`, 'approved', '文件内容符合法规与公司要求，批准发布') },
      U['qa.manager'], ctx);
    documents.transitionVersion(doc.id, version, 'effective',
      { reason: `${MARKER} 生效发布`, effectiveDate: dateAgo(60 + Math.floor(Math.random() * 300)),
        signatureId: signAs(U['qa.manager'], 'documents', doc.id, `doc:${num}`, 'released', '批准该文件于指定日期生效，并安排相关培训') },
      U['qa.manager'], ctx);
  }
  // One document left in draft, one left in review.
  documents.transitionVersion(docs['SOP-WH-030'].id, docs['SOP-WH-030'].versions[0].version, 'in_review',
    { reason: `${MARKER} 已提交，等待审核` }, U['qa.specialist'], ctx);
  // Backdate a review date so the periodic-review report has an overdue item.
  db.run('UPDATE documents SET next_review_date = ? WHERE doc_number = ?', [dateAgo(40), 'SOP-QC-011']);
  db.run('UPDATE document_versions SET review_due_date = ? WHERE document_id = ? AND status = ?',
    [dateAgo(40), docs['SOP-QC-011'].id, 'effective']);
  log(`documents          ${Object.keys(docs).length} created (${toRelease.length} 生效, 1 审核中, 1 草稿, 1 审核超期)`);

  // ---- equipment ----------------------------------------------------------
  const eqRecs = {};
  for (const e of EQUIPMENT) {
    const rec = equipment.createEquipment({
      assetNo: e.assetNo, name: e.name, nameEn: e.nameEn, model: e.model,
      manufacturer: e.manufacturer, location: e.location, department: e.department,
      gxpAreas: e.gxpAreas, criticality: e.criticality,
      calibrationIntervalDays: e.calibrationIntervalDays,
      maintenanceIntervalDays: e.maintenanceIntervalDays,
      qualificationStatus: e.qualificationStatus,
      csvStatus: e.csvStatus, csvRef: e.csvRef,
      iqDate: dateAgo(900), oqDate: dateAgo(880), pqDate: dateAgo(860),
      lastCalibrationDate: dateAgo(200), lastMaintenanceDate: dateAgo(60),
      status: 'in_service',
    }, U['engineering'], ctx);
    eqRecs[e.assetNo] = rec;
  }
  // One instrument past calibration and one approaching it, so the reports have content.
  db.run('UPDATE equipment SET next_calibration_date = ? WHERE asset_no = ?', [dateAgo(18), 'DIS-001']);
  db.run('UPDATE equipment SET next_calibration_date = ? WHERE asset_no = ?', [dateAhead(12), 'BAL-001']);
  db.run('UPDATE equipment SET next_maintenance_date = ? WHERE asset_no = ?', [dateAgo(7), 'TAB-001']);
  // An instrument that failed calibration and was taken out of service.
  equipment.recordCalibration(eqRecs['HPLC-002'].id, {
    performedAt: daysAgo(9, 11), performedBy: '外部校准机构 华测计量',
    result: 'fail', certificateNo: 'CAL-2026-0417',
    notes: `${MARKER} 流速准确度超出允差（实测 1.08 mL/min，允差 ±2%），判定不合格，仪器停用待维修后复校。`,
    intervalDays: 365,
  }, U['engineering'], ctx);
  log(`equipment          ${EQUIPMENT.length} created (1 校准超期, 1 即将到期, 1 维护超期, 1 校准不合格停用)`);

  // ---- quality records ----------------------------------------------------
  const records = {};

  /** Complete a step through the domain service, enforcing the real role gate. */
  function step(recordId, stepCode, actor, formData, comment, signatureId) {
    return workflow.completeStep({
      instanceId: recordId, stepCode, actor, ctx,
      formData, comment: `${MARKER} ${comment || ''}`.trim(), signatureId: signatureId || null,
    });
  }

  // ---- DEV-1: closed minor deviation, fully documented --------------------
  {
    const dev = workflow.createInstance({
      processCode: 'DEV', title: '压片间相对湿度短时超出内控标准',
      summary: `${MARKER} 2026-03-11 压片间 A 相对湿度达 52%（内控 ≤ 50%），持续约 25 分钟，期间未进行压片操作。`,
      criticality: 'minor', department: '生产部', site: '华东制药（演示）',
      batchNumber: 'B2026-0311', product: 'XX 片 10mg',
      occurredAt: daysAgo(195, 10), detectedAt: daysAgo(195, 11),
    }, U['prod.operator'], ctx);
    step(dev.id, 'report', U['prod.operator'], {
      discoveryContext: '操作工在整点时读取温湿度记录仪时发现湿度超限，立即报告班组长并通知工程部。',
      immediateAction: '暂停压片操作，关闭通往走廊的门，启动除湿机；记录超限起止时间。',
    }, '发现并即时报告');
    step(dev.id, 'containment', U['prod.manager'], {
      containmentAction: '暂停该房间全部操作，对已压制的 12 万片半成品单独标识并隔离，等待评估。',
      affectedLots: 'B2026-0311（12 万片半成品）', productQuarantined: 'yes',
    }, '隔离半成品并暂停操作');
    step(dev.id, 'investigation', U['qa.specialist'], {
      rootCause: '除湿机组冷凝水排水管部分堵塞，导致除湿能力下降。同期厂区连续降雨，室外湿度偏高加剧了影响。',
      rootCauseMethod: '5 Whys',
      impactAssessment: '超限期间未进行压片操作，半成品为超限前压制，其水分与硬度均在内控范围内（水分 1.8%，硬度 78 N）。经评估对产品质量无影响。其他批次未受影响。',
      dataReviewed: '温湿度记录仪历史曲线、压片批记录 B2026-0311、除湿机组维护记录、同期环境监测数据。',
    }, '完成根本原因分析');
    const sig1 = signAs(U['qa.manager'], 'workflow_instances', dev.id, dev.recordKey, 'approved', '根本原因明确，影响评估充分，同意判定无需 CAPA，按纠正措施关闭', 'capa_decision');
    step(dev.id, 'capa_decision', U['qa.manager'], {
      capaRequired: 'no',
      justification: '根本原因为设备维护不到位，已通过疏通排水管并增加月度排水管检查项予以纠正。非系统性缺陷，无需 CAPA。',
      correctiveAction: '疏通除湿机组冷凝水排水管；在除湿机组月度点检表中增加排水管检查项。',
    }, '判定无需 CAPA，理由已记录', sig1);
    const sig2 = signAs(U['qa.manager'], 'workflow_instances', dev.id, dev.recordKey, 'closed', '纠正措施已验证，同期未再发生同类超限，批准关闭', 'qa_review');
    step(dev.id, 'qa_review', U['qa.manager'], {
      conclusion: '湿度超限未影响产品质量，半成品经检验合格后正常放行。纠正措施已实施并验证有效。',
      batchDisposition: 'release', regulatoryImpact: 'no',
      effectivenessCheckDue: dateAgo(120),
    }, '批准关闭', sig2);
    records['DEV-1'] = dev;
  }

  // ---- DEV-2: open major deviation with an effectiveness check outstanding
  {
    const dev = workflow.createInstance({
      processCode: 'DEV', title: '批生产记录第二人复核签名缺失',
      summary: `${MARKER} 2026-06-02 QA 在批记录审核时发现 B2026-0530 批记录第 3、4 页配液工序的第二人复核签名缺失，共 6 处。`,
      criticality: 'major', department: '生产部', site: '华东制药（演示）',
      batchNumber: 'B2026-0530', product: 'XX 片 10mg',
      occurredAt: daysAgo(110, 14), detectedAt: daysAgo(108, 9),
    }, U['qa.specialist'], ctx);
    step(dev.id, 'report', U['prod.operator'], {
      discoveryContext: '该批配液工序由两人两班连续完成，交接班时复核人未在记录上签名即离岗。',
      immediateAction: '立即通知当班复核人补签并说明情况；QA 介入评估记录的原始性。',
    }, '报告并即时处理');
    step(dev.id, 'containment', U['prod.manager'], {
      containmentAction: '暂停该批放行流程；对已完成的配液步骤进行追溯复核，确认操作数据本身完整。',
      affectedLots: 'B2026-0530', productQuarantined: 'yes',
    }, '暂停放行并追溯复核');
    step(dev.id, 'investigation', U['qa.specialist'], {
      rootCause: '交接班时段生产任务集中，复核人同时承担两个房间的复核职责，工作负荷超出其可完成范围。排班未考虑复核工作量。',
      rootCauseMethod: 'Ishikawa / Fishbone',
      impactAssessment: '配液工序的操作数据（投料量、搅拌时间、温度）均由设备自动记录且完整，与批记录记载一致，数据本身可靠。但复核环节缺失使记录审核控制失效，属于体系性缺陷。已评估其他批次：抽查同期 10 批，另有 1 批存在同类问题。',
      dataReviewed: 'B2026-0530 批记录、配液设备电子数据、同期 10 批记录抽查、排班表、复核人员岗位职责。',
    }, '根本原因指向排班与职责设计');
    const sig = signAs(U['qa.manager'], 'workflow_instances', dev.id, dev.recordKey, 'approved', '根本原因明确，需 CAPA 解决排班与复核职责问题，同意判定', 'capa_decision');
    const advanced = step(dev.id, 'capa_decision', U['qa.manager'], {
      capaRequired: 'yes',
      justification: '复核缺失源于排班设计未考虑复核工作量，属系统性缺陷，且已发现其他批次存在同类问题，必须以 CAPA 解决。',
      correctiveAction: '对 B2026-0530 及另 1 批完成补充复核并记录理由；修订排班规则。',
      preventiveAction: '在排班系统中按房间数配置复核人员，禁止同一复核人同时负责超过 2 个房间。',
      capaOwner: U['qa.specialist'].full_name, capaDueDate: dateAhead(20),
    }, '判定需要 CAPA', sig);
    records['DEV-2'] = { ...advanced, id: dev.id, recordKey: dev.recordKey };
  }

  // ---- DEV-3: overdue deviation, stuck awaiting investigation ------------
  {
    const dev = workflow.createInstance({
      processCode: 'DEV', title: '铝塑包装机热封温度波动超出验证范围',
      summary: `${MARKER} 铝塑包装机热封温度设定 145℃，运行中记录到最低 138℃、最高 152℃，超出工艺验证确认的 142-148℃ 范围，涉及约 3,000 板。`,
      criticality: 'major', department: '生产部', site: '华东制药（演示）',
      batchNumber: 'B2026-0618', product: 'XX 片 10mg',
      occurredAt: daysAgo(70, 15), detectedAt: daysAgo(70, 16),
      dueDate: dateAgo(40),
    }, U['prod.operator'], ctx);
    step(dev.id, 'report', U['prod.operator'], {
      discoveryContext: '包装操作工巡检时发现热封温度显示波动，超出 SOP 规定范围，立即停机并报告。',
      immediateAction: '停机；对已包装的 3,000 板单独隔离标识；通知工程部检查加热元件。',
    }, '发现即停机隔离');
    step(dev.id, 'containment', U['prod.manager'], {
      containmentAction: '该批全部隔离待评估；工程部更换热封加热棒与温控探头。',
      affectedLots: 'B2026-0618（3,000 板）', productQuarantined: 'yes',
    }, '隔离并更换部件');
    // Deliberately left in the investigation step and past due.
    records['DEV-3'] = dev;
  }

  // ---- DEV-4: critical deviation still open -------------------------------
  {
    const dev = workflow.createInstance({
      processCode: 'DEV', title: 'QC 分析员发现 HPLC 系统适用性不合格后重复进样未记录',
      summary: `${MARKER} 审计追踪核查发现 QC 分析员在 2026-07-28 含量测定中，前 3 次进样系统适用性不合格后删除序列段并重新进样，试针未在检验记录中说明。涉及 B2026-0725 含量测定。`,
      criticality: 'critical', department: '质量控制部', site: '华东制药（演示）',
      batchNumber: 'B2026-0725', product: 'XX 片 10mg',
      occurredAt: daysAgo(30, 10), detectedAt: daysAgo(30, 16),
      dueDate: dateAhead(5),
    }, U['qa.specialist'], ctx);
    step(dev.id, 'report', U['qc.analyst'], {
      discoveryContext: 'QA 在月度数据完整性核查中调阅 HPLC 审计追踪，发现序列编号不连续且存在未报告的进样段。',
      immediateAction: '保全该工作站原始数据与审计追踪导出件；暂停该分析员的独立检验权限；通知 QA 负责人。',
    }, '按数据完整性事件处置');
    step(dev.id, 'containment', U['qa.manager'], {
      containmentAction: '暂停 B2026-0725 的放行；暂停该分析员独立操作资格；对该工作站近 6 个月数据进行全面审计追踪核查。',
      affectedLots: 'B2026-0725 及相关 6 个月数据', productQuarantined: 'yes',
    }, '升级为数据完整性事件处理');
    // Left open at investigation: a critical, high-visibility case.
    records['DEV-4'] = dev;
  }

  // ---- OOS-1: closed OOS with a defensible no-CAPA conclusion -------------
  {
    const oos = workflow.createInstance({
      processCode: 'OOS', title: 'XX 片含量测定结果 92.8%（标准 95.0-105.0%）',
      summary: `${MARKER} 2026-04-22 B2026-0420 批含量测定首次结果为 92.8%，低于标准下限，按 OOS 程序启动调查。`,
      criticality: 'major', department: '质量控制部', site: '华东制药（演示）',
      batchNumber: 'B2026-0420', product: 'XX 片 10mg',
      occurredAt: daysAgo(155, 14), detectedAt: daysAgo(155, 15),
    }, U['qc.analyst'], ctx);
    step(oos.id, 'initial_report', U['qc.analyst'], {
      testMethod: 'SOP-QC-011 HPLC 含量测定法（现行版）',
      specification: '95.0% - 105.0% 标示量',
      observedResult: '92.8%', rawDataRef: 'HPLC-001 序列号 SEQ-2026-0422-03，图谱文件已归档',
      instrumentUsed: 'HPLC-001（校准有效期至 2026-11-30）',
      sampleCondition: '样品为整批混合样，称量前在干燥器中平衡 30 分钟。',
    }, '按 OOS 程序报告');
    step(oos.id, 'phase1_lab', U['qc.analyst'], {
      systemSuitability: '系统适用性符合要求：理论塔板数 8,420，拖尾因子 1.05，RSD 0.4%',
      chromatogramsReviewed: '图谱未见异常峰、气泡或漏液；主峰保留时间 4.82 min，与对照品一致。',
      calculationsVerified: '称量 20.15 mg、稀释倍数 100、软件计算参数复核无误，手工复算结果 92.7%，与系统一致。',
      instrumentCheck: '仪器压力平稳，进样针无堵塞，柱温 30℃ 稳定。',
      reagentCheck: '对照品批号 RS-2026-003，效期 2027-03；流动相当日新配；色谱柱批号 8821，使用 47 次（限 200 次）。',
      labErrorFound: 'no',
      phase1Conclusion: '未发现实验室差错，计算结果准确，原始数据可靠。首次结果有效，必须进入阶段二全面调查。',
    }, '排除实验室差错，进入阶段二');
    step(oos.id, 'phase2_full', U['qc.manager'], {
      productionReview: '复核 B2026-0420 批记录：投料量正确，混合时间 25 分钟符合工艺规程，压片片重差异 1.8%（限 ±3%），硬度 76-82 N。设备参数均在验证范围内。',
      rootCause: '混合工序实际使用的主药原料粒度分布偏细（D90 为 86 μm，常规 45-60 μm），导致混合均匀度下降，成品含量均匀度处于边缘。原料入厂检验仅控制含量，未控制粒度。',
      rootCauseMethod: 'Ishikawa / Fishbone',
      batchImpact: '同批其余检项（溶出度、有关物质、微生物）均合格。同产品其他批次使用不同批号原料，粒度正常，含量在 99% 以上。已上市批次未受影响。稳定性留样正在按计划进行。',
      ootAnalysis: '近 12 个月含量结果均值 99.4%，首次低于 95%，不属于趋势性下降。',
    }, '根本原因指向原料粒度');
    const sigD = signAs(U['qa.manager'], 'workflow_instances', oos.id, oos.recordKey, 'disposition', '实验室差错已排除，根本原因为原料粒度未纳入入厂控制，批次判定不合格，原料标准需变更', 'qa_disposition');
    step(oos.id, 'qa_disposition', U['qa.manager'], {
      retestJustified: 'yes_original_invalid',
      retestPlan: '不允许以复测结果推翻原判定。原因为生产环节且已找到根本原因，复测无科学依据。',
      resampleJustified: 'no',
      investigationConclusion: '阶段一排除实验室差错；阶段二确认为原料粒度导致混合均匀度下降。原结果有效，判定不合格。',
      batchDisposition: 'reject',
      justification: '含量 92.8% 低于标准下限且原因为产品本身，按标准判定不合格。不得以复测合格为由放行。',
    }, '判定不合格，拒绝以复测推翻', sigD);
    records['OOS-1'] = oos;
  }

  // ---- CC-1: change control raised from the OOS conclusion ----------------
  {
    const cc = workflow.createInstance({
      processCode: 'CC', title: '主药原料质量标准增加粒度分布控制项',
      summary: `${MARKER} 源自 OOS-2026-0001 调查结论：原料粒度未纳入入厂控制，导致成品含量均匀度风险。拟在原料质量标准中增加 D90 ≤ 70 μm 的粒度控制项。`,
      criticality: 'major', department: '质量控制部', site: '华东制药（演示）',
      product: 'XX 片 10mg', dueDate: dateAhead(45),
    }, U['qc.manager'], ctx);
    step(cc.id, 'request', U['qc.manager'], {
      rationale: 'OOS-2026-0001 调查确认为原料粒度偏细导致成品含量偏低。现行原料标准仅控制含量与鉴别，未控制影响混合均匀度的粒度参数。',
      currentState: '原料质量标准 SPEC-RAW-007（现行版）仅规定性状、鉴别、含量、干燥失重。',
      proposedState: '增加激光粒度分布测定项，接受标准 D90 ≤ 70 μm，D50 ≤ 40 μm，方法经验证后纳入。',
      changeType: 'specification',
    }, '提出变更申请');
    step(cc.id, 'impact_assessment', U['qa.specialist'], {
      qualityImpact: '提高原料一致性，降低成品含量均匀度风险。对成品质量标准无影响。',
      validationImpact: '粒度测定方法需完成方法验证（精密度、重复性、耐用性）。混合工序工艺验证无需重做，但需在后续 3 批中增加含量均匀度加密取样。',
      regulatoryImpact: '原料内控标准收紧属于企业内部标准变更，不涉及注册变更。但需确认供应商能否稳定满足新标准。',
      csvImpact: '激光粒度仪数据采集软件需确认审计追踪与权限设置，纳入计算机化系统清单。',
      ehsImpact: '粒度测定为干法，需评估粉尘暴露，建议在通风柜内操作。',
      stabilityImpact: '无影响。',
      trainingImpact: 'QC 分析员需培训粒度测定方法；采购与 QA 需培训新标准。',
      documentImpact: '修订 SPEC-RAW-007、SOP-QC-011（增加粒度测定）、《原料入厂检验规程》。',
    }, '完成五维度影响评估');
    records['CC-1'] = cc;
  }

  // ---- CAPA-1: linked to DEV-2 ------------------------------------------
  {
    const capa = workflow.createInstance({
      processCode: 'CAPA', title: '修订排班规则以保障批记录复核资源',
      summary: `${MARKER} 源自 DEV-2026-0002：批记录第二人复核签名缺失，根本原因为排班未考虑复核工作量。`,
      criticality: 'major', department: '生产部', site: '华东制药（演示）',
      dueDate: dateAhead(75),
      parentId: records['DEV-2'].id, linkType: 'capa_for',
    }, U['qa.specialist'], ctx);
    step(capa.id, 'root_cause', U['qa.specialist'], {
      rootCause: '排班系统按生产房间数配置操作人员，但未同步配置复核人员数量，导致一名复核人需同时覆盖 4 个房间，交接班时段工作负荷集中。',
      method: 'Ishikawa / Fishbone',
      scopeAssessment: '抽查同期 10 批记录，另发现 1 批存在同类问题（B2026-0512）。已一并纳入本次 CAPA 范围。其他车间采用单人单房间模式，未发现同类问题。',
    }, '确认根本原因与影响范围');
    const sig = signAs(U['qa.manager'], 'workflow_instances', capa.id, capa.recordKey, 'approved', '措施针对根本原因且可验证，涉及设备与人员配置，需与变更控制关联实施', 'plan_approval');
    step(capa.id, 'plan_approval', U['qa.manager'], {
      correctiveActions: '1. 对 B2026-0530 与 B2026-0512 完成补充复核并记录理由；2. 立即调整当班复核人员配置。',
      preventiveActions: '1. 修订排班规则：同一复核人同时负责房间数不超过 2 个；2. 在排班系统中增加复核人员配置校验；3. 交接班时段增加 30 分钟重叠时间。',
      systemicAction: '修订《生产排班管理规程》，增加复核资源配置的强制校验条款。',
      ownerPerAction: '1-2 项：赵国强；3 项：黄燕（培训与制度）',
      duePerAction: `1-2 项：${dateAhead(15)}；3 项：${dateAhead(60)}`,
    }, '批准措施计划', sig);
    records['CAPA-1'] = capa;
  }

  // ---- CAPA-2: from the OOS, with an outstanding effectiveness check -----
  {
    const capa = workflow.createInstance({
      processCode: 'CAPA', title: '原料入厂检验增加粒度分布控制',
      summary: `${MARKER} 源自 OOS-2026-0001：原料粒度未纳入入厂控制。通过变更控制 CC-2026-0001 实施。`,
      criticality: 'major', department: '质量控制部', site: '华东制药（演示）',
      dueDate: dateAgo(10),
      parentId: records['OOS-1'].id, linkType: 'capa_for',
    }, U['qc.manager'], ctx);
    step(capa.id, 'root_cause', U['qc.manager'], {
      rootCause: '原料质量标准未包含对混合均匀度有影响的粒度参数，属于标准设计缺陷而非操作差错。',
      method: '5 Whys',
      scopeAssessment: '涉及全部使用该原料的产品（XX 片 10mg、XX 片 20mg）。已排查 20mg 规格近 12 个月数据，含量均值 99.8%，但存在同类潜在风险，一并纳入控制范围。',
    }, '确认标准设计缺陷');
    const sig = signAs(U['qa.manager'], 'workflow_instances', capa.id, capa.recordKey, 'approved', '措施通过变更控制实施，方法验证与标准修订路径清晰，批准', 'plan_approval');
    step(capa.id, 'plan_approval', U['qa.manager'], {
      correctiveActions: '1. 修订原料质量标准增加粒度项；2. 完成粒度测定方法验证；3. 对现有库存原料进行粒度复检。',
      preventiveActions: '1. 建立原料关键质量属性（CQA）评估程序，新原料批准前必须评估对成品关键质量属性的影响；2. 供应商质量协议增加粒度稳定性承诺。',
      systemicAction: '在《供应商质量管理规程》中增加 CQA 评估的前置要求。',
      ownerPerAction: '孙丽华（QC）',
      duePerAction: `全部：${dateAgo(10)}（已超期）`,
    }, '批准措施计划', sig);
    step(capa.id, 'implementation', U['qc.manager'], {
      actionsCompleted: '已完成粒度测定方法验证（报告 MV-2026-014）；已修订 SPEC-RAW-007 至第 2 版；已对库存 3 批原料完成粒度复检，其中 1 批 D90 为 78 μm 判不合格并退货。',
      evidenceRefs: 'SPEC-RAW-007 v2.0 生效日期 2026-08-15；方法验证报告 MV-2026-014；库存复检记录 QR-2026-0331；退货单 RT-2026-008。',
      documentsRevised: 'SPEC-RAW-007 v2.0、SOP-QC-011（增加粒度测定章节）',
      trainingDelivered: 'yes',
    }, '措施已实施，证据齐备');
    // Deliberately left before the effectiveness check, which is now overdue.
    records['CAPA-2'] = capa;
  }

  log(`quality records    ${db.get('SELECT COUNT(*) AS n FROM workflow_instances').n} created`);

  // ---- GLP / GCP / GDP / GVP / GPP demonstration content ------------------
  // Kept in a separate module because it is a large, self-contained body of
  // domain-specific narrative. It receives the signing and step helpers so all
  // of its records go through the same signature gates and audit path as the
  // GMP records above - nothing here bypasses the kernel.
  const domains = require('./demo-domains');
  const domainSummary = domains.seed({
    signAs,
    step,
    users: U,
    ctx,
  });
  log(`domain content     ${domainSummary.curricula} curricula, ${domainSummary.documents} documents, `
    + `${domainSummary.equipment} equipment across GLP/GCP/GDP/GVP/GPP`);
  log(`domain records     ${Object.keys(domainSummary.records).join(', ')}`);

  // ---- self-inspection with assessed findings and a linked CAPA ----------
  {
    const insp = inspections.createInspection({
      templateCode: 'DI-ALCOA-PLUS',
      title: '2026 年度数据完整性专项自查',
      inspectionType: 'self_inspection',
      site: '华东制药（演示）',
      scope: '覆盖质量控制部、生产部与仓储物流部的纸质与电子记录，重点核查审计追踪、账号唯一性、原始数据定义与记录修改规范。自查期间：2026-01-01 至 2026-07-31。',
      leadAuditor: U['qa.auditor'].full_name,
      scheduledDate: dateAgo(35),
      gxpAreas: ['GDPR-DataIntegrity', 'GMP'],
    }, U['qa.auditor'], ctx);

    const findings = db.all('SELECT * FROM inspection_findings WHERE inspection_id = ? ORDER BY id', [insp.id]);

    // Grade a realistic portion and deliberately leave the rest unassessed: a
    // self-inspection that is 100% complete with every gap already closed tells
    // the user nothing about how the readiness score behaves, and would not
    // reflect a real inspection in progress.
    const gapFindings = [];
    let idx = 0;
    for (const f of findings) {
      idx += 1;
      // Roughly two thirds assessed; the unassessed tail keeps the progress bar
      // and the "not yet assessed" counters meaningful.
      if (idx > Math.floor(findings.length * 0.66)) break;

      // Deterministic but mixed outcome: every 5th item is a gap, every 7th is
      // partially compliant, every 9th is genuinely not applicable. Low-risk
      // items are far more likely to be compliant than critical ones.
      const isGap = (idx % 5 === 0) || (f.risk_level === 'critical' && idx % 4 === 1);
      const isPartial = !isGap && idx % 7 === 0;
      const isNotApplicable = !isGap && !isPartial && idx % 9 === 0;

      if (isGap || isPartial) {
        gapFindings.push(f);
        inspections.assessItem(f.id, {
          grade: isGap ? 'gap' : 'partial',
          observation: gapObservation(idx),
          objectiveEvidence: gapEvidence(idx),
          riskLevel: f.risk_level,
          findingType: f.risk_level === 'critical' ? 'critical' : (f.risk_level === 'major' ? 'major' : 'minor'),
          ownerId: isGap && f.risk_level === 'critical' ? U['qa.manager'].id : U['qa.specialist'].id,
          dueDate: dateAhead(30 + (idx % 5) * 15),
          notes: `${MARKER} 自查评估`,
        }, U['qa.auditor'], ctx);
      } else {
        inspections.assessItem(f.id, {
          grade: isNotApplicable ? 'not_applicable' : 'compliant',
          observation: isNotApplicable ? '本场所无相应活动，判定为不适用。' : null,
          objectiveEvidence: isNotApplicable ? '经与 QA 负责人确认，本场所未开展该项活动，故不适用。' : null,
          notes: `${MARKER} 自查评估`,
        }, U['qa.auditor'], ctx);
      }
    }

    const assessedCount = db.get(
      "SELECT COUNT(*) AS n FROM inspection_findings WHERE inspection_id = ? AND assessed_grade != 'not_assessed'",
      [insp.id]
    ).n;
    log(`self-inspection    ${insp.code} created (${assessedCount}/${findings.length} 项已评估, ${gapFindings.length} 项缺陷, 其余待评估)`);

    const refreshed = inspections.getInspection(insp.id);
    log(`readiness score    ${refreshed.readinessScore}% (含 10 项未关闭缺陷)`);

    // Escalate the most serious gap into a CAPA, demonstrating the cross-module link.
    if (gapFindings.length) {
      const target = gapFindings.find((f) => f.risk_level === 'critical') || gapFindings[0];
      const escalated = inspections.escalateToCapa(target.id, {
        processCode: 'CAPA',
        title: '建立电子表格使用清单并完成验证',
        summary: `${MARKER} 源自自查 ${insp.code}：QC 使用未受控的 Excel 计算表进行含量与溶出度计算，公式未锁定，无版本控制。`,
        ownerId: U['qc.manager'].id,
      }, U['qa.auditor'], ctx);
      records['CAPA-3'] = escalated.workflow;
      log(`escalation         ${target.clause_ref || ''} → ${escalated.workflow.recordKey}`);
    }
    records['INSP-1'] = insp;
  }

  // ---- production batch execution (the operator's working day) -----------
  // A batch record is the operator's daily work. Four batches are seeded at
  // different points so every role on the production line has a real pending
  // task: PRD-0001 waits for the operator to issue material, PRD-0002 for the
  // charge step, PRD-0003 for the production manager's review, and PRD-0004 for
  // QC/QP disposition. Everything goes through the same workflow engine, signature
  // gates and audit trail as the quality records - nothing here bypasses the
  // kernel.
  {
    const batches = {};

    /** Create the batch record, then walk it forward to the target step. */
    function makeBatch(seq, product, batchNo, line, qty, walk) {
      const rec = workflow.createInstance({
        processCode: 'BATCH-EXEC',
        title: `${product} 批次 ${batchNo}`,
        product, batchNumber: batchNo, line, plannedQty: qty,
        department: '生产部', site: '华东制药（演示）',
        // Authored by the operator who executes it. Deliberately NOT the
        // production manager: the review step demands independence from the author
        // (Annex 11 §12.1), and seeding it with the manager as creator would let
        // the engine catch us - exactly as it did when this was tried the first
        // time. The operator writes the batch record; the manager reviews it.
      }, U['prod.operator'], ctx);
      batches[`PRD-${seq}`] = rec;
      if (walk) walk(rec);
      return rec;
    }

    // At the very first step: 领料与核对 pending (operator's inbox).
    makeBatch('0001', 'AP 片 10mg', 'B2026-0601', '片剂车间 A 线', '420000 片', null);

    // Step 1 done; 投料与工艺参数 pending (operator's inbox).
    makeBatch('0002', 'AP 片 10mg', 'B2026-0602', '片剂车间 A 线', '420000 片', (rec) => {
      step(rec.id, 'material_issue', U['prod.operator'], {
        materialCode: 'MAT-AP-01', materialLot: 'M2026-0508',
        quantityKg: '84.0', materialStatus: '合格',
        checks: '品名、批号、数量与领料单一致；内包装完好；在库效期内。',
      }, '领料核对完成');
    });

    // Steps 1-2 done; 过程取样 pending (operator's inbox).
    makeBatch('0003', 'AP 片 10mg', 'B2026-0603', '片剂车间 A 线', '420000 片', (rec) => {
      step(rec.id, 'material_issue', U['prod.operator'], {
        materialCode: 'MAT-AP-01', materialLot: 'M2026-0509',
        quantityKg: '84.2', materialStatus: '合格',
        checks: '品名、批号、数量与领料单一致；内包装完好；在库效期内。',
      }, '领料核对完成');
      step(rec.id, 'charge_and_parameters', U['prod.operator'], {
        chargeQtyKg: '84.0', mixingTimeMin: '25', mixingSpeed: '20',
        temperature: '36', paramCheck: '达标',
      }, '投料完成，参数全部在范围内');
    });

    // Steps 1-3 done, review signed; 放行评审 pending (QC/QP inbox).
    {
      const rec = makeBatch('0004', 'XX 胶囊 20mg', 'C2026-0601', '胶囊车间 B 线', '280000 粒', (r) => {
        step(r.id, 'material_issue', U['prod.operator'], {
          materialCode: 'MAT-XX-02', materialLot: 'M2026-0512',
          quantityKg: '56.0', materialStatus: '合格',
          checks: '品名、批号、数量与领料单一致；内包装完好；在库效期内。',
        }, '领料核对完成');
        step(r.id, 'charge_and_parameters', U['prod.operator'], {
          chargeQtyKg: '56.0', mixingTimeMin: '30', mixingSpeed: '18',
          temperature: '24', paramCheck: '达标',
        }, '投料完成，参数全部在范围内');
        step(r.id, 'process_sampling', U['prod.operator'], {
          samplePoint: '灌装中段', sampleNo: 'C2026-0601-S1', sampleQty: '40',
          retentionKept: 'yes',
        }, '中段取样完成并转交 QC');
        const sigReview = signAs(U['prod.manager'], 'workflow_instances', r.id, r.recordKey,
          'reviewed', '批记录填写完整，参数与投料量核对无误，过程无偏差，同意提交放行评审', 'production_review');
        step(r.id, 'production_review', U['prod.manager'], {
          reviewConclusion: '批记录完整，参数均在范围内，取样与留样符合规定，核对无误，可以转入放行评审。',
          deviationsDuringRun: '无', recordComplete: 'yes',
        }, '生产复核通过', sigReview);
      });
      batches['PRD-0004'] = rec;
    }

    log(`batch records      PRD-2026-0001..0004 created (operator / review / disposition pending)`);
    records['PRD-0004'] = batches['PRD-0004'];
  }

  // ---- final integrity check ---------------------------------------------
  const chain = audit.verifyChain();
  const elapsed = Date.now() - started;

  process.stdout.write('\n');
  log(`audit entries      ${db.get('SELECT COUNT(*) AS n FROM audit_trail').n}`);
  log(`signatures         ${db.get('SELECT COUNT(*) AS n FROM signatures WHERE valid = 1').n}`);
  log(`audit chain        ${chain.ok ? 'VERIFIED' : `*** BROKEN at seq ${chain.brokenAt}: ${chain.reason}`}`);
  log(`elapsed            ${elapsed} ms`);
  process.stdout.write('\n');
  process.stdout.write('  Demo accounts (password for all):  ' + DEMO_PASSWORD + '\n');
  if (adminCreated) {
    process.stdout.write(`    ${'admin'.padEnd(18)} ${'系统负责人'.padEnd(8)} ${'系统管理员'}${adminCreated ? '  <- administrator' : ''}\n`);
  }
  for (const p of PEOPLE) {
    process.stdout.write(`    ${p.username.padEnd(18)} ${p.fullName.padEnd(8)} ${p.jobTitle}\n`);
  }
  process.stdout.write('\n  Sign in at http://127.0.0.1:8788 as qa.manager to see a fully\n');
  process.stdout.write('  populated dashboard, or as prod.operator to see how the role gates\n');
  process.stdout.write('  restrict what the shop floor can do.\n');
  process.stdout.write('\n  REMINDER: this instance now contains fictional GxP records. Do not use it\n');
  process.stdout.write('  for real work. Delete data\\gxp.db to start clean.\n\n');

  db.close();
  process.exit(chain.ok ? 0 : 2);
}

/** Narrative observations for the self-inspection gaps. */
function gapObservation(i) {
  const texts = [
    '未建立数据完整性方针文件，质量手册中无数据完整性章节，管理层未明确数据完整性的期望与责任。',
    'QC 使用未受控的 Excel 计算表进行含量与溶出度计算，公式未锁定，无版本控制与访问保护。',
    '审计追踪审核未纳入数据审核清单，数据审核记录中无审计追踪审核的证据。',
    'HPLC 工作站时间未与厂区 NTP 服务器同步，实测偏差 4 分钟，可能影响记录时间顺序判断。',
    '原始数据定义仅在培训材料中提及，未在 SOP 中明确规定工作站电子数据为原始数据、打印件为核证副本。',
    '禁用行为清单已传达但未要求员工签署知晓确认书，无书面证据。',
  ];
  return texts[i % texts.length];
}

function gapEvidence(i) {
  const texts = [
    '查阅质量手册（2024 版）全文，无数据完整性相关章节；访谈 QA 负责人确认尚未建立该方针。',
    '现场打开 3 个计算表文件，单元格保护未启用，属性显示最后修改人为「Administrator」，无法追溯具体操作者。',
    '抽查 5 份数据审核记录，审核内容仅包含结果数值，均未见对审计追踪的核查记录；数据审核清单中无对应条目。',
    '在工作站执行 w32tm /query /status，显示上次同步时间为 2026-06-02；与服务器时间对比偏差 4 分 12 秒。',
    '查阅 SOP-QA-001 现行版，第 4.2 条仅写「原始数据应妥善保存」，未区分电子数据与纸质打印件的原始性。',
    '查阅数据完整性培训记录，仅记录签到，无知晓确认书；访谈 2 名操作工，均表示了解禁止行为但未签署过文件。',
  ];
  return texts[i % texts.length];
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`\n  Demo seed failed: ${err && err.stack ? err.stack : err}\n\n`);
    try { db.close(); } catch { /* ignore */ }
    process.exit(1);
  });
}
