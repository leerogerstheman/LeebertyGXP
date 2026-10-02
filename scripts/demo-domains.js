'use strict';

/**
 * Domain-specific demonstration content for GLP, GCP, GDP, GVP and GPP.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * The original demo dataset was almost entirely GMP: a solid-dosage plant with
 * deviations, an OOS and CAPAs. GLP, GCP, GDP, GVP and GPP had process
 * definitions and checklists but no records, so opening those areas showed an
 * empty list. That makes the multi-domain claim hollow - the point of a
 * configuration-driven kernel is that all these domains run on the same engine,
 * and that is only visible if each one has real records to look at.
 *
 * Each function below creates records through the real domain services, so every
 * one of them carries genuine electronic signatures and lands in the audit chain
 * exactly like production use would. Severity, timing and narrative are chosen
 * so that the background monitor has something real to chase in each domain
 * (an overdue record here, an expiring qualification there), because a
 * demonstration where nothing is ever late does not show the workflow engine
 * doing its job.
 *
 * All content is fictional. It references no real company, product, site,
 * institution or person.
 */

const db = require('../src/core/db');
const workflow = require('../src/domain/workflow');
const documents = require('../src/domain/documents');
const training = require('../src/domain/training');
const equipment = require('../src/domain/equipment');

const MARKER = '[演示数据 DEMO]';

function daysAgo(days, hour = 9) {
  const d = new Date(Date.now() - days * 86400000);
  d.setHours(hour, Math.floor((days * 7) % 60), 0, 0);
  return d.toISOString();
}
function dateAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
function dateAhead(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }

// ============================================================ curricula ======

const CURRICULA = [
  {
    code: 'GLP-STUDY',
    title: 'GLP 研究实施与原始数据',
    titleEn: 'GLP Study Conduct and Raw Data',
    gxpAreas: ['GLP'],
    appliesToRoles: ['lab_manager', 'lab_technician', 'qa_auditor', 'qc_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: 'GLP 原则与 21 CFR Part 58 要求、专题负责人职责、QA 部门独立性、原始数据记录与更正规范、标本标识与交接链、档案管理要求。',
  },
  {
    code: 'GLP-ANIMAL',
    title: '实验动物管理与动物福利',
    titleEn: 'Laboratory Animal Management and Welfare',
    gxpAreas: ['GLP'],
    appliesToRoles: ['lab_technician', 'lab_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: '动物接收与检疫、饲养环境与温湿度控制、给药与观察记录、动物福利伦理要求、异常情况处理。',
  },
  {
    code: 'GCP-E6',
    title: 'GCP 基础与 ICH E6(R2)',
    titleEn: 'GCP Foundation and ICH E6(R2)',
    gxpAreas: ['GCP'],
    appliesToRoles: ['clinical_pi', 'clinical_monitor', 'qa_specialist', 'qa_manager', 'ra_officer'],
    validityMonths: 24, isGxpCritical: true,
    description: 'ICH E6(R2) 与 NMPA GCP 要求、伦理委员会职责、研究者与申办者责任、监查与稽查、必备文件管理。',
  },
  {
    code: 'GCP-ICF',
    title: '知情同意实施与受试者保护',
    titleEn: 'Informed Consent and Subject Protection',
    gxpAreas: ['GCP'],
    appliesToRoles: ['clinical_pi', 'clinical_monitor', 'lab_technician'],
    validityMonths: 12, isGxpCritical: true,
    description: '知情同意的法规要求与全部要素、知情同意过程记录、特殊人群保护、重新知情同意的触发条件、常见缺陷与案例。',
  },
  {
    code: 'GCP-SAFETY',
    title: '临床试验安全性报告',
    titleEn: 'Clinical Trial Safety Reporting',
    gxpAreas: ['GCP', 'GVP'],
    appliesToRoles: ['clinical_pi', 'clinical_monitor', 'pharmacovigilance'],
    validityMonths: 24, isGxpCritical: true,
    description: 'AE/SAE 定义与判定、严重性与关联性评估、SAE 报告时限（首次获知日起算）、随访与转归、与药物警戒体系的衔接。',
  },
  {
    code: 'GDP-STORAGE',
    title: '药品储运与冷链管理',
    titleEn: 'GDP Storage and Cold Chain Management',
    gxpAreas: ['GDP'],
    appliesToRoles: ['warehouse_keeper', 'qa_specialist'],
    validityMonths: 24, isGxpCritical: true,
    description: '储存条件与温湿度监测、温度分布验证与最差条件、收货与验收、冷链运输与保温箱验证、温度超限处置与影响评估、退货处置规则。',
  },
  {
    code: 'GDP-RECALL',
    title: '投诉、退货与召回执行',
    titleEn: 'Complaints, Returns and Recall Execution',
    gxpAreas: ['GDP'],
    appliesToRoles: ['warehouse_keeper', 'qa_specialist', 'qa_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: '投诉接收与调查、退货药品处置条件、召回分级与深度、客户追溯能力、召回有效性检查、假劣药识别与报告。',
  },
  {
    code: 'GVP-ICSR',
    title: '个例安全性报告处理与时限',
    titleEn: 'ICSR Processing and Reporting Timelines',
    gxpAreas: ['GVP'],
    appliesToRoles: ['pharmacovigilance', 'clinical_monitor', 'qa_specialist', 'qa_manager'],
    validityMonths: 24, isGxpCritical: true,
    description: '四要素判定、首次获知日与时限起算、严重性与预期性评估、关联性判断、E2B(R3) 提交、超时原因记录、随访要求。',
  },
  {
    code: 'GVP-SIGNAL',
    title: '信号检测与风险管理',
    titleEn: 'Signal Detection and Risk Management',
    gxpAreas: ['GVP'],
    appliesToRoles: ['pharmacovigilance', 'qa_manager', 'ra_officer'],
    validityMonths: 24, isGxpCritical: false,
    description: '信号检测方法与频率依据、信号验证与优先级、获益-风险评价、风险最小化措施实施与有效性评估、定期安全性更新报告。',
  },
  {
    code: 'GPP-PREP',
    title: '医疗机构制剂配制规范',
    titleEn: 'Hospital Preparation Compounding Practice',
    gxpAreas: ['GPP'],
    appliesToRoles: ['lab_technician', 'qc_analyst', 'qa_specialist', 'qa_manager', 'production_operator'],
    validityMonths: 24, isGxpCritical: true,
    description: '制剂配制管理要求、处方与配制规程、批配制记录、计算与称量双人复核、无菌操作技术、灭菌与无菌保证、标签与用药指导。',
  },
  {
    code: 'GPP-ASEPTIC',
    title: '无菌制剂配制与洁净操作',
    titleEn: 'Aseptic Preparation and Cleanroom Technique',
    gxpAreas: ['GPP'],
    appliesToRoles: ['lab_technician', 'qc_analyst'],
    validityMonths: 12, isGxpCritical: true,
    description: '洁净区行为规范、更衣与人员资格确认、无菌操作技术、洁净台与生物安全柜使用、环境监测、培养基模拟灌装要求。',
  },
];

// ============================================================= documents =====

const DOCUMENTS = [
  // --- GLP ---
  { docNumber: 'SOP-GLP-001', title: '专题研究方案编写与修订规程', titleEn: 'Study Plan Preparation and Amendment Procedure', docType: 'study_plan', department: '非临床研究中心', reviewPeriodMonths: 24, gxpAreas: ['GLP'], summary: '研究方案的内容要求、编写与审批流程、修订的条件与批准要求、方案偏离的记录与报告。' },
  { docNumber: 'SOP-GLP-002', title: '原始数据记录与更正规程', titleEn: 'Raw Data Recording and Correction Procedure', docType: 'sop', department: '非临床研究中心', reviewPeriodMonths: 24, gxpAreas: ['GLP'], summary: '原始数据的定义与范围、同步记录要求、更正的单线划改与签名规则、电子数据采集系统的稽查轨迹要求、禁止行为清单。' },
  { docNumber: 'SOP-GLP-003', title: '标本采集、标识与交接链管理规程', titleEn: 'Specimen Collection, Identification and Chain of Custody', docType: 'sop', department: '非临床研究中心', reviewPeriodMonths: 24, gxpAreas: ['GLP'], summary: '标本唯一标识规则、采集记录内容、交接签收要求、储存条件与温度记录、留样与销毁规定。' },
  { docNumber: 'SOP-GLP-004', title: '质量保证部门稽查规程', titleEn: 'QA Unit Inspection Procedure', docType: 'sop', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GLP'], summary: '主计划表维护、阶段稽查与设施稽查的计划与执行、稽查报告与整改跟踪、QA 声明的内容要求、向管理层报告的路径。' },

  // --- GCP ---
  { docNumber: 'PROT-2026-001', title: '某药物 II 期临床试验方案（第 3.0 版）', titleEn: 'Phase II Clinical Trial Protocol v3.0', docType: 'study_plan', department: '临床运营部', reviewPeriodMonths: 12, gxpAreas: ['GCP'], summary: '研究目的、入选排除标准、给药方案、访视计划、疗效与安全性终点、统计学考虑、方案偏离的定义与处理。' },
  { docNumber: 'SOP-GCP-001', title: '知情同意实施规程', titleEn: 'Informed Consent Implementation Procedure', docType: 'sop', department: '临床运营部', reviewPeriodMonths: 24, gxpAreas: ['GCP'], summary: '知情同意的时间要求（必须先于任何试验相关操作）、过程记录要求、全部法定要素核对清单、见证人适用情形、重新知情同意的触发条件。' },
  { docNumber: 'SOP-GCP-002', title: '方案偏离记录、评估与报告规程', titleEn: 'Protocol Deviation Recording, Assessment and Reporting', docType: 'sop', department: '临床运营部', reviewPeriodMonths: 24, gxpAreas: ['GCP'], summary: '偏离的定义与分级、重要偏离与一般偏离的判定标准、受试者与数据影响评估要求、通报伦理委员会与监管机构的时限。' },
  { docNumber: 'SOP-GCP-003', title: '安全性事件报告规程（AE/SAE）', titleEn: 'Adverse Event and Serious Adverse Event Reporting', docType: 'sop', department: '临床运营部', reviewPeriodMonths: 24, gxpAreas: ['GCP'], summary: 'AE/SAE 定义、严重性与关联性判定、SAE 报告时限（首次获知日起 24 小时内报告申办者）、妊娠报告要求、随访与转归记录。' },
  { docNumber: 'SOP-GCP-004', title: '源数据核对与监查规程', titleEn: 'Source Data Verification and Monitoring Procedure', docType: 'sop', department: '临床运营部', reviewPeriodMonths: 24, gxpAreas: ['GCP'], summary: '基于风险的监查计划制定、源数据核对范围与记录、监查报告与随访函、发现问题的分级与跟踪关闭。' },
  { docNumber: 'ICF-2026-001', title: '知情同意书模板（第 3.0 版，含全部法定要素）', titleEn: 'Informed Consent Form Template v3.0', docType: 'icf', department: '临床运营部', reviewPeriodMonths: 12, gxpAreas: ['GCP'], summary: '试验目的与程序、可预见的风险与不适、预期获益、替代治疗方案、补偿与损害赔偿条款、保密与隐私、自愿参加与随时退出的权利、联系方式。' },
  { docNumber: 'CRF-2026-001', title: '病例报告表模板与填写指南', titleEn: 'Case Report Form Template and Completion Guide', docType: 'crf', department: '临床运营部', reviewPeriodMonths: 24, gxpAreas: ['GCP'], summary: '各访视表单结构、字段定义与填写规则、数据修改规范、源数据与 CRF 的一致性要求、常见填写缺陷示例。' },

  // --- GDP ---
  { docNumber: 'SOP-GDP-001', title: '药品储存温湿度监测与超标处置规程', titleEn: 'Storage Temperature Monitoring and Excursion Handling', docType: 'sop', department: '仓储物流部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '监测点位设置依据（基于温度分布验证）、监测频次、报警响应流程、超限记录的保全、影响评估与产品处置的时限要求。' },
  { docNumber: 'SOP-GDP-002', title: '冷链运输与保温箱验证管理规程', titleEn: 'Cold Chain Transport and Shipper Validation', docType: 'validation_protocol', department: '仓储物流部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '运输路线风险评估方法、保温箱与冷媒配置的验证要求（含夏季与冬季最差条件）、实际发货配置与验证配置的一致性核查、再验证周期。' },
  { docNumber: 'SOP-GDP-003', title: '收货验收与冷链温度记录审核规程', titleEn: 'Goods Receipt and Cold Chain Record Review', docType: 'sop', department: '仓储物流部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '收货核对项目清单、冷链药品温度记录仪数据导出与审核步骤、超限时的拒收与偏差启动条件、待验区管理。' },
  { docNumber: 'SOP-GDP-004', title: '退货药品处置规程', titleEn: 'Returned Goods Handling Procedure', docType: 'sop', department: '仓储物流部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '退货接收与隔离、可重新入库的条件（原包装完好、储存运输条件未受影响、有客观证据）、QA 参与的处置决定、不可重新入库的处理方式。' },
  { docNumber: 'SOP-GDP-005', title: '药品召回与模拟召回演练规程', titleEn: 'Product Recall and Mock Recall Procedure', docType: 'recall_plan', department: '质量保证部', reviewPeriodMonths: 24, gxpAreas: ['GDP'], summary: '召回分级标准、通知对象与时限、客户追溯能力要求、回收率与有效性检查方法、模拟召回演练的频次与记录要求。' },

  // --- GVP ---
  { docNumber: 'SOP-GVP-001', title: '个例安全性报告接收与处理规程', titleEn: 'ICSR Intake and Processing Procedure', docType: 'sop', department: '药物警戒部', reviewPeriodMonths: 24, gxpAreas: ['GVP'], summary: '接收渠道与值守安排、四要素判定、首次获知日的记录要求及其来源、有效性判定（含判定为无效的记录要求）、查重与合并、数据录入质量控制。' },
  { docNumber: 'SOP-GVP-002', title: '安全性报告时限管理与超时处置规程', titleEn: 'Safety Reporting Timeline and Overdue Management', docType: 'sop', department: '药物警戒部', reviewPeriodMonths: 24, gxpAreas: ['GVP'], summary: '时限起算规则（首次获知日）、15 日与 7 日报告要求、节假日与代理人情形下的处理、超时原因记录要求与 CAPA 触发条件、时限合规率统计与趋势分析。' },
  { docNumber: 'SOP-GVP-003', title: '信号检测与管理规程', titleEn: 'Signal Detection and Management Procedure', docType: 'sop', department: '药物警戒部', reviewPeriodMonths: 24, gxpAreas: ['GVP'], summary: '信号检测方法（病例系列评价、 disproportionality 分析）与频率依据、信号验证与优先级排序、评估结论的要求、需采取行动时的处置流程、信号关闭标准。' },
  { docNumber: 'SOP-GVP-004', title: '定期安全性更新报告编制规程', titleEn: 'Periodic Safety Update Report Preparation', docType: 'sop', department: '药物警戒部', reviewPeriodMonths: 24, gxpAreas: ['GVP'], summary: '数据锁定点的确定依据、报告周期、各章节内容要求、获益-风险评价方法、内部审核与批准流程、提交渠道与回执管理。' },

  // --- GPP ---
  { docNumber: 'SOP-GPP-001', title: '医疗机构制剂配制管理规程', titleEn: 'Hospital Preparation Compounding Procedure', docType: 'sop', department: '药剂科', reviewPeriodMonths: 24, gxpAreas: ['GPP'], summary: '配制指令的下达与审核、处方与配制规程、批配制记录的填写要求、计算与称量的双人独立复核、配制环境要求、半成品与成品管理。' },
  { docNumber: 'SOP-GPP-002', title: '无菌制剂配制与洁净区操作规范', titleEn: 'Aseptic Preparation and Cleanroom Practice', docType: 'sop', department: '药剂科', reviewPeriodMonths: 24, gxpAreas: ['GPP'], summary: '洁净区级别与行为规范、更衣流程与人员资格确认、洁净台与生物安全柜的使用与维护、无菌操作技术要点、环境监测要求与超标处置。' },
  { docNumber: 'SOP-GPP-003', title: '制剂标签与用药指导规程', titleEn: 'Preparation Labelling and Patient Counselling', docType: 'sop', department: '药剂科', reviewPeriodMonths: 24, gxpAreas: ['GPP'], summary: '标签必载内容（制剂名称、批号、配制日期、有效期、贮存条件、用法用量）、与上市药品的区分标识、发放时的处方审核、患者用药指导内容与记录。' },
  { docNumber: 'SOP-GPP-004', title: '制剂配制偏差与检验超标处理规程', titleEn: 'Preparation Deviation and OOS Handling', docType: 'sop', department: '药剂科', reviewPeriodMonths: 24, gxpAreas: ['GPP'], summary: '偏差的识别与报告时限、是否已发放至患者的判断与临床通知要求、实验室调查与全面调查的分界、制剂处置与效期调整规则、患者安全措施。' },
];

// ============================================================= equipment =====

const EQUIPMENT = [
  // --- GLP: non-clinical study facility ---
  { assetNo: 'ANIMAL-RM-01', name: '动物房温湿度控制系统', nameEn: 'Animal Room HVAC Control', model: 'AHU-AN-01', manufacturer: '天加', location: '动物房 A 区', department: '非临床研究中心', gxpAreas: ['GLP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 90, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GLP-BAL-01', name: '动物称重天平', nameEn: 'Animal Weighing Balance', model: 'Mettler ML3002', manufacturer: 'Mettler Toledo', location: '动物房 A 区', department: '非临床研究中心', gxpAreas: ['GLP'], criticality: 'critical', calibrationIntervalDays: 180, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GLP-META-01', name: '代谢笼系统', nameEn: 'Metabolism Cage System', model: 'MC-24', manufacturer: 'Tecniplast', location: '动物房 B 区', department: '非临床研究中心', gxpAreas: ['GLP'], criticality: 'major', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GLP-BIO-01', name: '生物分析仪（ELISA 读数仪）', nameEn: 'Bioanalytical Plate Reader', model: 'Molecular Devices SpectraMax', manufacturer: 'Molecular Devices', location: '分析实验室', department: '非临床研究中心', gxpAreas: ['GLP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-BIO-001' },
  { assetNo: 'GLP-FRZ-01', name: '超低温冰箱（-80℃）', nameEn: 'Ultra-low Temperature Freezer', model: 'Thermo TSX', manufacturer: 'Thermo Fisher', location: '样本库', department: '非临床研究中心', gxpAreas: ['GLP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },

  // --- GCP: investigational site equipment ---
  { assetNo: 'GCP-ECG-01', name: '十二导联心电图机', nameEn: '12-lead ECG Machine', model: 'GE MAC 2000', manufacturer: 'GE Healthcare', location: '临床试验中心 1 诊室', department: '临床研究中心', gxpAreas: ['GCP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GCP-CENT-01', name: '低温离心机', nameEn: 'Refrigerated Centrifuge', model: 'Eppendorf 5810R', manufacturer: 'Eppendorf', location: '临床试验中心样本处理室', department: '临床研究中心', gxpAreas: ['GCP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GCP-FRZ-01', name: '临床样本冰箱（-20℃）', nameEn: 'Clinical Sample Freezer', model: 'Haier DW-25L', manufacturer: '海尔生物医疗', location: '临床试验中心样本处理室', department: '临床研究中心', gxpAreas: ['GCP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GCP-TEMP-01', name: '临床样本冰箱温度监测系统', nameEn: 'Sample Freezer Monitoring System', model: 'TempTrak CT', manufacturer: 'Thermo Fisher', location: '临床试验中心样本处理室', department: '临床研究中心', gxpAreas: ['GCP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-CTMS-001' },

  // --- GDP: distribution and cold chain ---
  { assetNo: 'GDP-COLD-01', name: '冷藏库（2-8℃）', nameEn: 'Cold Room (2-8 C)', model: 'CR-30', manufacturer: '海尔生物医疗', location: '区域配送中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GDP-TRUCK-01', name: '冷藏运输车（2-8℃）', nameEn: 'Refrigerated Delivery Van', model: 'Fuso Canter 冷藏车', manufacturer: '三菱扶桑', location: '区域配送中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 90, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GDP-LOGGER-01', name: '冷链温度记录仪（20 台批次）', nameEn: 'Cold Chain Data Loggers', model: 'Elpro LIBERO CE', manufacturer: 'Elpro', location: '区域配送中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GDP-TEMP-01', name: '仓储温湿度自动监测系统', nameEn: 'Warehouse Temperature Monitoring System', model: 'TempTrak WH', manufacturer: 'Thermo Fisher', location: '区域配送中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-WHMS-001' },
  { assetNo: 'GDP-SHIPPER-01', name: '保温箱（验证配置：2-8℃）', nameEn: 'Validated Passive Shipper', model: 'PCM-48', manufacturer: 'va-Q-tec', location: '区域配送中心', department: '仓储物流部', gxpAreas: ['GDP'], criticality: 'critical', calibrationIntervalDays: 0, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },

  // --- GPP: hospital preparation pharmacy ---
  { assetNo: 'GPP-CSH-01', name: '水平层流洁净工作台', nameEn: 'Horizontal Laminar Flow Clean Bench', model: '苏净 SW-CJ-1FD', manufacturer: '苏州净化', location: '静脉配制中心', department: '药剂科', gxpAreas: ['GPP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GPP-BSC-01', name: 'II 级生物安全柜', nameEn: 'Class II Biological Safety Cabinet', model: 'Thermo 1300 A2', manufacturer: 'Thermo Fisher', location: '静脉配制中心', department: '药剂科', gxpAreas: ['GPP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GPP-AUTO-01', name: '高压蒸汽灭菌器', nameEn: 'Autoclave', model: '致微 GI54DWS', manufacturer: '致微仪器', location: '药剂科灭菌间', department: '药剂科', gxpAreas: ['GPP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GPP-BAL-01', name: '千分之一天平', nameEn: 'Precision Balance', model: 'Mettler PL2002', manufacturer: 'Mettler Toledo', location: '药剂科配制间', department: '药剂科', gxpAreas: ['GPP'], criticality: 'critical', calibrationIntervalDays: 180, maintenanceIntervalDays: 365, qualificationStatus: 'qualified', csvStatus: 'not_applicable' },
  { assetNo: 'GPP-ENV-01', name: '洁净区环境监测系统（浮游菌/沉降菌/尘埃粒子）', nameEn: 'Cleanroom Environmental Monitoring', model: 'EMS-PH-01', manufacturer: '苏州华宇', location: '静脉配制中心', department: '药剂科', gxpAreas: ['GPP'], criticality: 'critical', calibrationIntervalDays: 365, maintenanceIntervalDays: 180, qualificationStatus: 'qualified', csvStatus: 'validated', csvRef: 'CSV-EMS-PH-001' },
];

/**
 * Parameterise the two helpers the caller owns, so this module stays free of
 * signing and step logic (which belongs to the demo generator).
 *
 * @param {object} api
 * @param {(user: object, entityType: string, entityId: number, recordKey: string,
 *          meaning: string, reason: string, stepCode?: string|null) => number} api.signAs
 * @param {(recordId: number, stepCode: string, actor: object, formData: object,
 *          comment?: string, signatureId?: number|null) => object} api.step
 * @param {object} api.users  map of username -> user row
 * @param {object} api.ctx
 */
function seed(api) {
  const { signAs, step, users: U } = api;

  // ------------------------------------------------------------ curricula --
  const curricula = {};
  for (const c of CURRICULA) {
    const existing = db.get('SELECT id FROM training_curricula WHERE code = ?', [c.code]);
    if (existing) {
      curricula[c.code] = training.getCurriculum(existing.id);
      continue;
    }
    curricula[c.code] = training.createCurriculum({
      code: c.code, title: c.title, titleEn: c.titleEn, gxpAreas: c.gxpAreas,
      appliesToRoles: c.appliesToRoles, validityMonths: c.validityMonths,
      isGxpCritical: c.isGxpCritical, description: c.description,
    }, U['qa.manager'], api.ctx);
  }

  // ----------------------------------------------------------- documents ---
  const docs = {};
  for (const d of DOCUMENTS) {
    const existing = db.get('SELECT id FROM documents WHERE doc_number = ?', [d.docNumber]);
    if (existing) {
      docs[d.docNumber] = documents.getDocument(existing.id);
      continue;
    }
    docs[d.docNumber] = documents.createDocument({
      docNumber: d.docNumber, title: d.title, titleEn: d.titleEn, docType: d.docType,
      department: d.department, reviewPeriodMonths: d.reviewPeriodMonths,
      gxpAreas: d.gxpAreas, summary: d.summary, retentionYears: 10,
      changeReason: `${MARKER} 建立演示用受控文件`,
      changeSummary: '初始发布',
    }, U['qa.manager'], api.ctx);
  }
  for (const [num, doc] of Object.entries(docs)) {
    if (doc.status === 'effective') continue;
    const version = doc.versions[0].version;
    documents.transitionVersion(doc.id, version, 'in_review',
      { reason: `${MARKER} 提交审核` }, U['qa.specialist'], api.ctx);
    documents.transitionVersion(doc.id, version, 'approved',
      {
        reason: `${MARKER} 审核通过`,
        signatureId: signAs(U['qa.manager'], 'documents', doc.id, `doc:${num}`, 'approved',
          '文件内容符合法规与公司要求，批准发布'),
      }, U['qa.manager'], api.ctx);
    documents.transitionVersion(doc.id, version, 'effective',
      {
        reason: `${MARKER} 生效发布`, effectiveDate: dateAgo(30 + Math.floor(Math.random() * 200)),
        signatureId: signAs(U['qa.manager'], 'documents', doc.id, `doc:${num}`, 'released',
          '批准该文件于指定日期生效，并安排相关培训'),
      }, U['qa.manager'], api.ctx);
  }

  // ----------------------------------------------------------- equipment ---
  const eq = {};
  for (const e of EQUIPMENT) {
    const existing = db.get('SELECT id FROM equipment WHERE asset_no = ?', [e.assetNo]);
    if (existing) {
      eq[e.assetNo] = equipment.getEquipment(existing.id);
      continue;
    }
    eq[e.assetNo] = equipment.createEquipment({
      assetNo: e.assetNo, name: e.name, nameEn: e.nameEn, model: e.model,
      manufacturer: e.manufacturer, location: e.location, department: e.department,
      gxpAreas: e.gxpAreas, criticality: e.criticality,
      calibrationRequired: e.calibrationIntervalDays > 0,
      calibrationIntervalDays: e.calibrationIntervalDays || undefined,
      maintenanceIntervalDays: e.maintenanceIntervalDays,
      qualificationStatus: e.qualificationStatus,
      csvStatus: e.csvStatus, csvRef: e.csvRef,
      iqDate: dateAgo(700), oqDate: dateAgo(680), pqDate: dateAgo(660),
      lastCalibrationDate: dateAgo(150), lastMaintenanceDate: dateAgo(45),
      status: 'in_service',
    }, U['engineering'], api.ctx);
  }
  // Date drift that gives the monitor something real to chase in each domain.
  db.run('UPDATE equipment SET next_calibration_date = ? WHERE asset_no = ?', [dateAgo(11), 'GLP-BIO-01']);
  db.run('UPDATE equipment SET next_calibration_date = ? WHERE asset_no = ?', [dateAhead(9), 'GCP-ECG-01']);
  db.run('UPDATE equipment SET next_maintenance_date = ? WHERE asset_no = ?', [dateAgo(16), 'GDP-TRUCK-01']);
  db.run('UPDATE equipment SET next_calibration_date = ? WHERE asset_no = ?', [dateAhead(4), 'GPP-BSC-01']);
  // A GDP instrument taken out of service by a failed calibration.
  equipment.recordCalibration(eq['GDP-LOGGER-01'].id, {
    performedAt: daysAgo(6, 10), performedBy: '外部校准机构 华测计量',
    result: 'fail', certificateNo: 'CAL-2026-0788',
    notes: `${MARKER} 抽检 5 台记录仪中 1 台在 -20℃ 点示值偏差 -0.9℃（允差 ±0.5℃），判定该批次不合格。`
      + '该记录仪所记录的在途温度数据可靠性需评估，已暂停使用并对相关车次数据复核。',
    intervalDays: 365,
  }, U['engineering'], api.ctx);

  // ---------------------------------------------------- training records ---
  // [curriculum, username, daysAgoCompleted?] — the day count is optional; a
  // spread of completion dates across recent months keeps the expiry picture
  // varied rather than making every qualification expire on the same day.
  const trainingPlan = [
    ['GLP-STUDY', 'qa.auditor', 70], ['GLP-STUDY', 'qc', 64], ['GLP-ANIMAL', 'qc', 58],
    ['GCP-E6', 'qa.manager', 55], ['GCP-E6', 'qa.specialist', 52],
    ['GCP-ICF', 'qa.specialist', 40], ['GCP-ICF', 'qa.auditor', 35],
    ['GCP-SAFETY', 'qa.manager', 80], ['GCP-SAFETY', 'qa.specialist', 75],
    ['GDP-STORAGE', 'warehouse.keeper', 25], ['GDP-STORAGE', 'qa.specialist', 60],
    ['GDP-RECALL', 'warehouse.keeper', 20], ['GDP-RECALL', 'qa.manager', 65],
    ['GVP-ICSR', 'qa.manager', 50], ['GVP-SIGNAL', 'qa.manager', 45],
    ['GPP-PREP', 'qa.specialist', 30], ['GPP-ASEPTIC', 'qa.specialist', 28],
  ];
  for (const [code, username, completedDaysAgo] of trainingPlan) {
    const days = typeof completedDaysAgo === 'number' ? completedDaysAgo : 45;
    const cur = curricula[code];
    const user = U[username];
    if (!cur || !user) continue;
    const already = db.get(
      "SELECT id FROM training_records WHERE curriculum_id = ? AND user_id = ? AND status = 'completed'",
      [cur.id, user.id]
    );
    if (already) continue;
    training.assign(cur.id, { userIds: [user.id], dueDate: dateAgo(Math.max(1, days - 20)) }, U['trainer'], api.ctx);
    const rec = db.get(
      'SELECT * FROM training_records WHERE curriculum_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
      [cur.id, user.id]
    );
    training.recordCompletion(rec.id, {
      status: 'completed', method: 'classroom', score: 88 + (days % 9), passMark: 80, result: 'pass',
      trainerName: U['trainer'].full_name, trainedBy: U['trainer'].id,
      completedAt: daysAgo(days, 14), validityMonths: curricula[code].validityMonths,
      evidence: `${MARKER} 培训记录与考核卷归档于培训档案`,
      notes: `${MARKER} 演示培训记录`,
      signatureId: signAs(U['trainer'], 'training_records', rec.id, `training:${rec.id}`, 'completed',
        `确认 ${user.full_name} 已完成《${cur.title}》培训并通过考核`),
    }, U['trainer'], api.ctx);
  }

  // Deliberate gaps so each domain contributes to the readiness picture.
  // An overdue GVP assignment: the highest-frequency real-world finding.
  training.assign(curricula['GVP-ICSR'].id,
    { userIds: [U['qa.specialist'].id], dueDate: dateAgo(18) }, U['trainer'], api.ctx);
  // An expired GCP qualification: a subject-facing role is no longer current.
  const expired = db.get(
    "SELECT tr.id FROM training_records tr JOIN training_curricula c ON c.id = tr.curriculum_id " +
    "WHERE c.code = 'GCP-ICF' AND tr.user_id = ? AND tr.status = 'completed'",
    [U['qa.auditor'].id]
  );
  if (expired) {
    db.run('UPDATE training_records SET expires_at = ? WHERE id = ?', [dateAgo(9), expired.id]);
  }

  const records = {};
  seedGlp(records, { signAs, step, U, ctx: api.ctx });
  seedGcp(records, { signAs, step, U, ctx: api.ctx });
  seedGdp(records, { signAs, step, U, ctx: api.ctx });
  seedGvp(records, { signAs, step, U, ctx: api.ctx });
  seedGpp(records, { signAs, step, U, ctx: api.ctx });

  return {
    curricula: Object.keys(curricula).length,
    documents: Object.keys(docs).length,
    equipment: Object.keys(eq).length,
    records,
  };
}

// ================================================================== GLP =====

function seedGlp(records, { signAs, step, U }) {
  // --- GLP-1: closed specimen chain deviation with reconstruction evidence ---
  {
    const rec = workflow.createInstance({
      processCode: 'GLP-SPEC',
      title: 'A 区动物尿样标本标签脱落导致标识不清',
      summary: `${MARKER} 2026-05-14 在代谢笼试验第 14 天样本采集时，发现 6 只动物的尿样采集管标签脱落，`
        + '无法直接确认对应动物编号。涉及 TOX-2026-014 研究第 14 天样本。',
      criticality: 'major', department: '动物房', site: '非临床研究中心（演示）',
      studyCode: 'TOX-2026-014', protocolNumber: 'TOX-2026-014 v2.0',
      occurredAt: daysAgo(130, 10), detectedAt: daysAgo(130, 11),
    }, U['lab.tech'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'record', U['lab.tech'], {
      deviationType: 'specimen_misidentification',
      whatHappened: '样本采集后放置于采集架，标签因冷凝水浸湿脱落。采集记录显示该架对应 7-12 号动物，'
        + '但无法逐一对应到具体编号。采集人当场发现并停止后续采集。',
      affectedSpecimens: '6 支尿样采集管（原对应 7-12 号动物）', timeWindow: '2026-05-14 09:20-09:50',
      preservationAction: '立即停止采集，将 6 支样本单独隔离并封存于 2-8℃ 样本柜；保全采集原始记录与代谢笼位置图；'
        + '通知专题负责人与 QA。未对样本做任何标注或推测性标注。',
      rawDataRef: '采集记录本 TOX-2026-014 第 3 册第 41 页；代谢笼位置图附件 2',
    }, '保全证据并停止采集');

    step(rec.id, 'qa_notification', U['qa.auditor'], {
      qaNotifiedAt: '2026-05-14 10:15',
      studyDirectorInformed: 'yes',
      studyDirectorResponse: '专题负责人确认该 6 只动物仍有备用尿样可用于后续分析，第 14 天尿量数据可能缺失。',
      qaInitialComment: 'QA 已现场确认样本隔离状态与原始记录完整性。采集人主动报告且未做推测性标注，行为正确。',
    }, 'QA 现场确认并通知专题负责人');

    // The signature must come from the same person who performs the step: the
    // kernel refuses a signature applied on someone else's behalf.
    const sig = signAs(U['lab.manager'], 'workflow_instances', rec.id, rec.recordKey, 'reviewed',
      '标本标识不清但采集记录完整可交叉验证，要求补充交叉核对证据后判定数据可用性', 'impact_assessment');
    step(rec.id, 'impact_assessment', U['lab.manager'], {
      dataIntegrityImpact: '受影响数据仍可归属：采集记录本记载了采集顺序与代谢笼位置，与笼位图交叉核对后可唯一对应。'
        + '样本未做推测性标注，数据可追溯性未受破坏。',
      reconstructable: 'fully_reconstructable',
      dataValidity: 'valid_data_retained',
      studyImpact: '第 14 天尿量与尿生化数据经交叉核对后可用。因存在对应关系推导，最终报告需在偏离章节说明核对方法与依据。'
        + '不影响研究终点指标与统计学分析。',
      affectedAnimals: '7-12 号动物（6 只）', affectedParameters: '第 14 天尿量、尿蛋白、尿糖',
      rootCause: '样本管标签为普通纸质标签，冷凝水浸湿后失去粘性。SOP 未规定标签材质要求，也未要求采集后立即加盖防护。'
        + '属于流程设计缺陷而非个人操作差错。',
      reportingRequired: 'yes',
    }, '交叉核对确认数据可重建', sig);

    step(rec.id, 'resolution', U['lab.manager'], {
      correction: '该 6 只动物第 14 天样本采用备用样复测，数据经交叉核对后纳入分析。',
      prevention: '1. 样本管改用防水耐低温标签；2. 修订 SOP 增加「采集后立即加盖并置于防护架」步骤；'
        + '3. 采集架增加编号分区，降低混样风险。',
      sopRevised: 'yes', sopRef: 'SOP-GLP-003 v2.0（生效 2026-06-20）',
      trainingDone: 'yes',
      systemChange: '拟在 LIMS 中增加标本条码打印与交接扫描功能，替代手工标签（已列入 2026 年度信息化计划）。',
    }, '修订 SOP 与标签材质');

    const sig2 = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'closed',
      '纠正与预防措施已实施，SOP 已修订并完成培训，最终报告偏离章节已明确说明', 'close');
    step(rec.id, 'close', U['qa.manager'], {
      qaConclusion: '标本标识不清属流程设计缺陷，已通过标签材质与 SOP 修订解决。受影响数据经交叉核对可重建，判定数据可用，'
        + '研究结论不受影响。已在最终报告偏离章节说明。',
      reportedToManagement: 'yes',
      studyDirectorAgreement: 'yes',
      finalReportReference: 'TOX-2026-014 最终报告第 11.2 节「方案偏离与标本处理说明」',
    }, '批准关闭', sig2);

    records['GLP-1'] = rec;
  }

  // --- GLP-2: open deviation, past due, on the QA notification step --------
  {
    const rec = workflow.createInstance({
      processCode: 'GLP-SPEC',
      title: '动物房 B 区温湿度记录连续 3 日缺失',
      summary: `${MARKER} QA 例行设施稽查发现动物房 B 区温湿度自动记录系统在 2026-08-02 至 08-04 期间无数据，`
        + '第 08-05 日恢复。系统故障期间由人工抄表记录，但抄表记录缺少抄表人签名。涉及 DRF-2026-008 研究。',
      criticality: 'major', department: '动物房', site: '非临床研究中心（演示）',
      studyCode: 'DRF-2026-008', protocolNumber: 'DRF-2026-008 v1.0',
      occurredAt: daysAgo(56, 8), detectedAt: daysAgo(7, 14),
      dueDate: dateAgo(3),
    }, U['qa.auditor'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'record', U['qa.auditor'], {
      deviationType: 'raw_data_not_contemporaneous',
      whatHappened: '温湿度自动记录系统因传感器故障停止采集，连续 3 日无自动数据。期间由值班人员每日两次人工抄表，'
        + '纸质抄表记录格式为手绘表格，无抄表人签名、无复核签名，无法确认记录人。',
      affectedSpecimens: '不涉及样本；受影响为环境监测原始数据（3 日）', timeWindow: '2026-08-02 至 2026-08-04',
      preservationAction: '保全纸质抄表原件与系统故障日志；导出系统故障前后的历史曲线；未对纸质记录做任何补签。',
      rawDataRef: '动物房 B 区人工抄表记录第 22-24 页；系统故障日志 2026-08-02 07:14',
    }, '保全纸质记录与故障日志');

    // Deliberately left mid-flow and past its due date.
    records['GLP-2'] = rec;
  }
  return records;
}

// ================================================================== GCP =====

function seedGcp(records, { signAs, step, U }) {
  // --- GCP-1: critical informed-consent timing deviation, closed -----------
  {
    const rec = workflow.createInstance({
      processCode: 'GCP-IC',
      title: '受试者 0107 知情同意签署晚于筛选期检查',
      summary: `${MARKER} 监查访视发现受试者 0107 的知情同意书签署日期为 2026-06-11，`
        + '而其筛选期血常规、生化、心电图检查均在 2026-06-10 完成，早于知情同意签署。'
        + '涉及试验 PROT-2026-001 第 3.0 版方案。',
      criticality: 'critical', department: '临床运营部', site: '中心 03（演示）',
      studyCode: 'PROT-2026-001', protocolNumber: 'PROT-2026-001 v3.0', subjectId: '0107',
      occurredAt: daysAgo(93, 9), detectedAt: daysAgo(88, 14),
    }, U['qa.specialist'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'identify', U['qa.specialist'], {
      eventType: 'consent_after_procedure',
      factualAccount: '受试者 0107 于 2026-06-10 上午到院，研究者先开具筛选期检查（血常规、生化、心电图），'
        + '检查完成后于当日下午进行知情同意沟通并签署同意书，签署日期填写 2026-06-11。'
        + '门诊病历记载 06-10 完成检查，知情同意书记载 06-11 签署。',
      consentDate: dateAgo(93), firstProcedureDate: dateAgo(94),
      proceduresBeforeConsent: '筛选期血常规、血生化、十二导联心电图、生命体征测量',
      consentVersionUsed: 'ICF-2026-001 v3.0（现行版）',
      irbApprovedVersion: 'ICF-2026-001 v3.0（现行版，一致）',
      discoveredBy: '监查员在源数据核对时对比门诊病历与知情同意书日期发现',
      sourceDataRef: '门诊病历 2026-06-10 记录；知情同意书原件编号 ICF-0107-01',
    }, '监控源数据核对时发现');

    const sig = signAs(U['clinical.pi'], 'workflow_instances', rec.id, rec.recordKey, 'reviewed',
      '筛选检查属于试验相关操作，签署晚于检查构成知情同意偏离，受试者未在充分知情前提下接受检查', 'assess_impact');
    step(rec.id, 'assess_impact', U['clinical.pi'], {
      subjectRightsImpact: '受试者在接受筛选检查前未签署知情同意，未能在充分知情的前提下决定是否接受这些检查。'
        + '筛选检查均为常规无创或低风险项目（静脉采血、心电图），未造成医学损害，但受试者权益保障存在缺陷。',
      dataIntegrityImpact: '筛选期检查数据真实、准确，但产生时缺乏有效的知情同意基础。数据的可用性需由伦理委员会决定。',
      dataUseDecision: 'irb_decision_required',
      subjectContinues: 'continues',
      subjectInformed: 'yes',
      medicalConsequence: '无医学损害。静脉采血为常规操作，心电图无创。受试者已完成全部筛选检查，结果均在正常范围。',
      overallImpact: '属于重要的知情同意偏离。受试者权益保障存在缺陷，但未造成医学损害。数据可用性已提交伦理委员会决定。',
      rootCause: '研究中心筛选流程设计为先开检查后签同意：研究者习惯在门诊开单时一并开具筛选检查，'
        + '知情同意沟通安排在检查完成后由研究护士进行。流程本身存在顺序错误，属系统性缺陷。',
      vulnerablePopulation: 'no',
    }, '判定数据可用性需伦理决定', sig);

    step(rec.id, 'report', U['clinical.cra'], {
      irbNotified: 'yes', irbNotificationDate: dateAgo(85),
      irbResponse: '伦理委员会审查后认为：受试者权益保障存在缺陷但无医学损害，同意受试者继续参加试验；'
        + '该受试者筛选期数据可用于安全性分析，但不纳入有效性分析人群。要求提交整改报告。',
      sponsorNotified: 'yes',
      regulatoryNotified: 'no',
      reconsentRequired: 'no',
      reconsentPlan: '该受试者已于 06-11 签署现行版知情同意书，无需重复签署。已向受试者说明情况。',
      otherSubjectsAffected: '排查中心 03 全部在组受试者 14 例，发现另有 2 例存在同类情形（0103、0111）。'
        + '已一并纳入本记录处理范围并通报伦理委员会。其他中心排查未见同类问题。',
    }, '伦理委员会已审查并出具意见');

    step(rec.id, 'capa', U['clinical.cra'], {
      correctiveActions: '1. 向受试者 0107、0103、0111 说明情况并取得理解；2. 三例受试者数据按伦理意见分别处理，'
        + '有效性分析人群排除；3. 立即调整中心 03 的筛选流程。',
      preventiveActions: '1. 修订筛选流程图：知情同意签署为筛选访视的第一步，未签署不得开具任何检查；'
        + '2. 在门诊系统中对试验受试者设置提示，开单前需确认知情同意状态；'
        + '3. 增加研究护士在检查前的知情同意状态核查环节。',
      siteRetraining: 'yes',
      retrainingDetail: '对中心 03 全部研究团队 8 人开展知情同意专项培训，含流程顺序与案例讨论，考核全部通过。',
      processChange: '修订《知情同意实施规程》SOP-GCP-001 至 v2.0，明确「知情同意先于一切试验相关操作，含筛选检查」。',
      monitoringPlanChange: '将中心 03 列为重点监查中心，后续 3 次监查对知情同意相关源数据 100% 核对。',
      systemControl: '门诊系统已配置试验受试者开单前知情同意状态提醒（非强制拦截，由研究者确认）。',
      capaOwner: U['clinical.cra'].full_name, capaDueDate: dateAgo(30),
    }, '流程修订 + 专项培训 + 监查加密');

    const sig2 = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'closed',
      '伦理意见已执行，流程与系统控制已实施，后续监查未发现同类问题，有效性确认', 'close');
    step(rec.id, 'close', U['qa.manager'], {
      conclusion: '本次偏离根本原因为筛选流程顺序设计错误，属系统性缺陷，已通过流程修订、系统提醒与专项培训纠正。'
        + '涉及 3 例受试者数据按伦理委员会意见处理。未造成医学损害。',
      subjectOutcome: '受试者 0107 继续参加试验并完成随访；0103、0111 同样继续参加。三例均无不良事件。',
      dataUseFinal: 'excluded_from_efficacy_only',
      listedInReport: 'yes',
      effectivenessMethod: '后续 3 次监查对中心 03 知情同意源数据 100% 核对（累计核查 22 例次），'
        + '知情同意签署日期均早于首个试验操作；其他中心抽查 30 例次亦未发现同类问题。',
      effectivenessResult: 'effective',
    }, '有效性确认，批准关闭', sig2);

    records['GCP-1'] = rec;
  }

  // --- GCP-2: open protocol deviation awaiting impact assessment ----------
  {
    const rec = workflow.createInstance({
      processCode: 'GCP-PD',
      title: '受试者 0212 使用方案禁止的合并用药（糖皮质激素）',
      summary: `${MARKER} 受试者 0212 于 2026-09-02 因急性支气管炎在院外接受地塞米松注射治疗 3 天，`
        + '该药物属于方案第 5.4 节禁止的合并用药。受试者未主动告知，监查时通过门诊记录发现。'
        + '涉及 PROT-2026-001 试验。',
      criticality: 'major', department: '临床运营部', site: '中心 01（演示）',
      studyCode: 'PROT-2026-001', protocolNumber: 'PROT-2026-001 v3.0', subjectId: '0212',
      occurredAt: daysAgo(26, 10), detectedAt: daysAgo(19, 15),
      dueDate: dateAhead(4),
    }, U['qa.specialist'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'identify', U['qa.specialist'], {
      deviationType: 'prohibited_medication',
      protocolRequirement: '方案第 5.4 节：试验期间禁止使用全身性糖皮质激素。因医疗需要必须使用时，'
        + '受试者应退出试验并进入安全性随访。',
      actualConduct: '受试者 0212 于 2026-09-02 至 09-04 在社区卫生服务中心接受地塞米松 5mg 静滴，每日一次，共 3 次，'
        + '用于治疗急性支气管炎。受试者本人未在研究访视时主动报告，研究者亦未获知。',
      discoveredBy: '监查员在源数据核对时查阅受试者门诊与社区就诊记录发现',
      sourceDataRef: '社区卫生服务中心门诊记录 2026-09-02；受试者日记卡该周未记录合并用药',
    }, '监查源数据核对发现');

    // Left at the impact assessment step, within its due date but unresolved.
    records['GCP-2'] = rec;
  }
  return records;
}

// ================================================================== GDP =====

function seedGdp(records, { signAs, step, U }) {
  // --- GDP-1: closed cold chain excursion with a defensible disposition ----
  {
    const rec = workflow.createInstance({
      processCode: 'GDP-COLD',
      title: '冷链运输温度超限：最长 14.2℃ 持续 47 分钟',
      summary: `${MARKER} 2026-06-18 一批需 2-8℃ 储存的注射剂（批号 B2026-0615，120 箱）`
        + '由区域配送中心发往华东区域经销商，到货后导出温度记录仪数据发现途中最高温度 14.2℃，'
        + '累计超出 8℃ 的时间为 47 分钟，发生在中转装卸环节。',
      criticality: 'major', department: '仓储物流部', site: '区域配送中心（演示）',
      product: '某注射剂 2mL', batchNumber: 'B2026-0615',
      occurredAt: daysAgo(101, 13), detectedAt: daysAgo(100, 9),
      dueDate: dateAgo(87),
    }, U['warehouse.keeper'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'report', U['warehouse.keeper'], {
      discoveryContext: '收货方按 SOP-GDP-003 在验收时导出温度记录仪数据并审核，发现超限段。记录仪编号 LOG-0417，'
        + '校准有效期至 2027-03-31，数据有效。',
      requiredRange: '2-8℃（全程）',
      measuredRange: '最低 3.1℃，最高 14.2℃',
      duration: '累计超出 8℃ 共 47 分钟（最长连续 22 分钟）',
      loggerId: 'LOG-0417（校准有效期至 2027-03-31，有效）',
      immediateAction: '收货方立即将该批 120 箱全部隔离至待验区并加贴黄色标识；通知区域配送中心与 QA；'
        + '暂停向经销商发放该批产品。',
    }, '收货验收时发现并隔离');

    step(rec.id, 'containment', U['warehouse.keeper'], {
      quarantinedQuantity: '120 箱（全部）',
      distributionStatus: 'delivered_not_released',
      customersNotified: 'yes',
      quarantineLocation: '区域配送中心待验区 T-03 位，黄色「待验」标识，门禁隔离',
      affectedBatches: '同车次另有两种产品：某口服液（非冷链要求）不受影响；某生物制品（同 2-8℃ 要求）'
        + '使用独立保温箱与独立记录仪 LOG-0418，数据全程在范围内，正常放行。已逐一核对同车次全部货品。',
    }, '全部隔离并核对同车次货品');

    step(rec.id, 'impact_assessment', U['qa.specialist'], {
      stabilityBasis: '依据该产品稳定性研究数据：产品在 25℃ 条件下 6 个月的长期稳定性数据支持短期偏离。'
        + '供应商出具评估函（编号 SE-2026-0142）确认：2-8℃ 产品在 ≤25℃ 累计暴露不超过 8 小时、单次不超过 4 小时，'
        + '不影响产品质量。本次偏离（最高 14.2℃、累计 47 分钟）远低于该限度。',
      mktBasis: '平均动力学温度（MKT）计算为 7.8℃，仍在 2-8℃ 范围内；短期暴露限度为 25℃/4 小时。',
      productImpact: '经与稳定性数据及供应商评估函比对，本次温度偏离未超出产品的短期暴露限度，'
        + '评估认为对该批产品质量无影响。已完成外观检查，无异常。',
      physicalInspection: '120 箱外观检查合格，无冻融迹象、无渗漏、包装完整、标签清晰。',
      rootCause: '中转站装卸时货物在站台滞留 47 分钟。经核查，该站台当日空调故障，'
        + '且承运方未按 SOP 规定将货物直接转入中转冷藏区，而是暂存于站台等待下一车次。'
        + '属于承运方操作偏离运输作业指导书，同时暴露我方对中转环节的监督不足。',
      recurrenceRisk: '同一中转站每月约 12 车次。若不整改，夏季高温时段再发风险高。'
        + '本批为夏季首次发现，此前 3 个月该路线未见超限。',
    }, '依据稳定性数据与供应商评估函判定无影响');

    const sig = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'disposition',
      '偏离未超出产品短期暴露限度且有稳定性数据与供应商评估函支持，批准放行并附加运输过程限制', 'disposition');
    step(rec.id, 'disposition', U['qa.manager'], {
      disposition: 'release_with_restriction',
      dispositionBasis: '偏离（最高 14.2℃、累计 47 分钟、MKT 7.8℃）显著低于产品短期暴露限度（25℃/4 小时），'
        + '有本产品稳定性数据与供应商书面评估函支持。产品外观检查合格。评估认为质量未受影响，批准放行。',
      restrictions: '1. 该批产品剩余效期缩短 1 个月（由 2028-06 调整至 2028-05），系统内已标记；'
        + '2. 经销商发货时随货附温度偏离说明与评估结论；'
        + '3. 该批纳入后续 3 个月稳定性考察加密取样。',
      testingRequired: 'no',
      customerCommunication: '已向经销商书面说明偏离情况、评估依据与结论，并取得对方确认接收。',
      regulatoryNotification: 'no',
    }, '批准放行，附加效期与稳定性考察限制', sig);

    const sig2 = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'closed',
      '承运方整改已验证，路线风险评估已更新，后续 12 车次无超限，有效性确认', 'capa');
    step(rec.id, 'capa', U['qa.manager'], {
      correctiveActions: '1. 要求承运方立即修复该中转站站台空调；2. 承运方修订中转作业指导书，'
        + '明确货物到站后 15 分钟内必须转入中转冷藏区并留存转区记录；3. 对本次承运人员开展专项培训。',
      preventiveActions: '1. 更新该运输路线风险评估报告，将夏季高温时段的中转站滞留列为高风险点；'
        + '2. 在运输协议中增加中转站设备状态报备义务与违约条款；'
        + '3. 对高温时段（6-9 月）该路线车次实施 100% 温度记录审核，其他时段抽查 20%。',
      validationImpact: 'no',
      trainingDelivered: 'yes',
      effectivenessMethod: '后续 12 车次（含 5 车次夏季高温时段）温度记录 100% 审核，均全程在 2-8℃ 范围内；'
        + '中转站转区记录完整。承运方空调修复经现场确认。',
      carrierAudit: 'yes',
    }, '承运方整改已验证', sig2);

    records['GDP-1'] = rec;
  }

  // --- GDP-2: open return disposition dispute, past due -------------------
  {
    const rec = workflow.createInstance({
      processCode: 'GDP-RECALL',
      title: '经销商退货药品处置争议：是否可重新入库销售',
      summary: `${MARKER} 华东经销商退回某片剂 3 箱（批号 B2026-0720），退货原因为终端药房订单变更。`
        + '经销商称药品自出库至退回全程存放于其合格库房，且外包装完好。'
        + '但退货交接单未记录退回运输条件，且退回时外箱有轻微挤压痕迹。',
      criticality: 'major', department: '仓储物流部', site: '区域配送中心（演示）',
      product: '某片剂 20mg', batchNumber: 'B2026-0720',
      occurredAt: daysAgo(32, 11), detectedAt: daysAgo(30, 10),
      dueDate: dateAgo(9),
    }, U['warehouse.keeper'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'log', U['warehouse.keeper'], {
      complaintSource: 'distributor',
      complaintCategory: 'storage_transport',
      quantityAffected: '3 箱（每箱 200 盒）',
      sampleAvailable: 'yes',
      patientImpact: 'no',
      acknowledgedToComplainant: 'yes',
    }, '登记退货并隔离待处置');

    // Left awaiting investigation and past its due date: the disposition
    // question (may returned stock re-enter saleable inventory?) is exactly the
    // judgement that should not be made casually.
    records['GDP-2'] = rec;
  }
  return records;
}

// ================================================================== GVP =====

function seedGvp(records, { signAs, step, U }) {
  // --- GVP-1: ICSR reported late, with inadequate reason recording ---------
  {
    const rec = workflow.createInstance({
      processCode: 'GVP-AE',
      title: '严重不良反应个例报告提交超时（首次获知后第 23 日提交）',
      summary: `${MARKER} 个例报告 PV-2026-0074：患者服用某片剂后出现严重肝功能异常住院。`
        + '首次获知日为 2026-07-15（医生电话咨询），实际提交监管机构日期为 2026-08-07，'
        + '超出 15 日时限 8 天。超时原因登记为「病例信息不完整需随访」，但无随访记录佐证。',
      criticality: 'critical', department: '药物警戒部', site: '药物警戒部（演示）',
      product: '某片剂 20mg', batchNumber: 'B2026-0640',
      occurredAt: daysAgo(75, 9), detectedAt: daysAgo(40, 10),
      dueDate: dateAhead(6),
    }, U['qa.manager'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'intake', U['qa.manager'], {
      receivedDate: dateAgo(75),
      reportSource: '医务人员电话咨询（科室：消化内科）',
      patientAge: '60-69 岁', patientSex: 'female',
      fourElementsPresent: 'yes',
      validCase: 'valid',
    }, '四要素齐全，判定为有效个例报告');

    step(rec.id, 'triage', U['qa.manager'], {
      seriousness: 'serious',
      seriousnessCriteria: '住院治疗（ALT 升至正常上限 12 倍，AST 8 倍，住院保肝治疗 9 天）',
      expectedness: 'unexpected',
      relatedness: 'possible',
      reportingDeadline: '15_day',
      expeditedRequired: 'yes',
      safetyIssue: 'no',
    }, '判定为严重且非预期，需 15 日内快速报告');

    const sig = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'reviewed',
      '医学评价完成，因果关系判定为可能相关，但报告时限合规性存在缺陷需另行调查', 'medical_review');
    step(rec.id, 'medical_review', U['qa.manager'], {
      narrative: '患者女性，60-69 岁，因适应症服用某片剂 20mg 每日一次。用药第 18 天出现乏力、食欲减退、尿色加深，'
        + '第 21 天就诊查 ALT 达正常上限 12 倍，AST 8 倍，总胆红素轻度升高，当日收入院。'
        + '停药并给予保肝治疗后肝功能逐步恢复，住院 9 天后出院。无其他可疑合并用药，无饮酒史，'
        + '既往无肝病史。',
      medicalAssessment: '用药与肝功能异常存在时间关联性（用药后 18 天出现），停药后恢复，'
        + '无其他明确病因。按 WHO-UMC 评定标准判定为「可能相关」。属严重且非预期不良反应。',
      causalityConclusion: 'possibly_related',
      listednessReview: '对照现行说明书（2025-11 版），肝功能异常未列入不良反应项，判定为非预期。',
      actionTaken: '停药、住院保肝治疗、出院后门诊随访 4 周肝功能恢复正常',
      outcome: 'recovered',
    }, '医学评价完成，判定可能相关', sig);

    // The reporting-timeline investigation is deliberately left open: this is
    // the single highest-frequency critical finding in PV inspections.
    records['GVP-1'] = rec;
  }

  // --- GVP-2: pregnancy exposure, closed, showing special-situation capture -
  {
    const rec = workflow.createInstance({
      processCode: 'GVP-AE',
      title: '妊娠暴露报告：受试者用药期间妊娠（无不良结局）',
      summary: `${MARKER} 个例报告 PV-2026-0081：育龄女性受试者在临床试验用药期间确认妊娠，`
        + '末次用药后 11 天确认。已停药并转入妊娠随访。属于需纳入报告范围的特殊情形。',
      criticality: 'major', department: '药物警戒部', site: '药物警戒部（演示）',
      product: '某片剂 20mg', studyCode: 'PROT-2026-001', subjectId: '0104',
      occurredAt: daysAgo(58, 11), detectedAt: daysAgo(58, 11),
      dueDate: dateAgo(44),
    }, U['qa.manager'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'intake', U['pv.officer'] || U['qa.manager'], {
      receivedDate: dateAgo(58),
      reportSource: '临床试验中心研究者报告',
      patientAge: '25-34 岁', patientSex: 'female',
      fourElementsPresent: 'yes',
      validCase: 'valid',
    }, '四要素齐全，判定为有效报告');

    step(rec.id, 'triage', U['qa.manager'], {
      seriousness: 'non_serious',
      seriousnessCriteria: '尚无不良结局；属特殊情形，需按妊娠暴露纳入报告与随访',
      expectedness: 'not_applicable',
      relatedness: 'unassessable',
      reportingDeadline: 'periodic',
      expeditedRequired: 'no',
      safetyIssue: 'no',
    }, '判定为特殊情形，纳入定期报告');

    const sig = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'reviewed',
      '妊娠暴露已确认并纳入随访，无需快速报告但需持续跟踪至妊娠结局', 'medical_review');
    step(rec.id, 'medical_review', U['qa.manager'], {
      narrative: '受试者女性，30 岁，入组时妊娠试验阴性并采取有效避孕措施。用药第 34 天自测妊娠试验阳性，'
        + '同日血 HCG 确认妊娠。即刻停用试验药物，末次用药距确认妊娠 11 天。'
        + '超声检查孕周约 6 周，胚胎发育与孕周相符。',
      medicalAssessment: '属用药期间妊娠暴露。目前无不良结局，胎儿发育与孕周相符。'
        + '动物生殖毒性研究未显示致畸性，但人体数据有限。需持续随访至妊娠结局。',
      causalityConclusion: 'unassessable',
      listednessReview: '说明书已包含妊娠期用药警示（妊娠期不推荐使用），属预期情形。',
      actionTaken: '即刻停药、退出试验用药、转入妊娠随访、转产科专科随访',
      outcome: 'recovering',
    }, '医学评价完成，转入随访', sig);

    step(rec.id, 'submission', U['qa.manager'], {
      submittedTo: '纳入下一期定期安全性更新报告；已同步通报申办者与伦理委员会',
      submissionDate: dateAgo(50),
      submissionFormat: 'not_required',
      acknowledgement: '申办者回执 SP-2026-0341；伦理委员会回执 IEC-2026-0788',
      withinTimeline: 'yes',
    }, '按期纳入定期报告并完成通报');

    step(rec.id, 'follow_up', U['qa.manager'], {
      followUpAttempts: '分别于妊娠 6 周、12 周、20 周、28 周进行 4 次随访，均取得产科检查记录',
      newInformation: '妊娠 20 周超声未见结构异常；妊娠 28 周糖耐量试验正常；'
        + '妊娠 39 周顺产一活婴，Apgar 评分 9/10/10，出生体重 3,250 g，无先天异常。',
      followUpReportRequired: 'yes',
      caseClosurePossible: 'yes',
    }, '随访至妊娠结局，母婴均正常');

    const sig2 = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'closed',
      '妊娠结局为正常活产，无先天异常，本个例可结案，并纳入定期报告', 'closure');
    step(rec.id, 'closure', U['qa.manager'], {
      caseConclusion: '用药期间妊娠暴露，母婴结局正常。已按特殊情形处理并完成随访。'
        + '该个例纳入下一期定期安全性更新报告的妊娠暴露汇总分析。',
      signalAssessment: 'no_signal',
      actionRequired: '无需变更说明书。建议在定期报告中持续汇总妊娠暴露病例，累积数据后重新评价。',
      psurInclude: 'yes',
    }, '结案并纳入定期报告', sig2);

    records['GVP-2'] = rec;
  }
  return records;
}

// ================================================================== GPP =====

function seedGpp(records, { signAs, step, U }) {
  // --- GPP-1: critical calculation error already dispensed to a patient ----
  {
    const rec = workflow.createInstance({
      processCode: 'GPP-PREP',
      title: '静脉营养液葡萄糖浓度配制错误并已用于患者',
      summary: `${MARKER} 2026-03-24 静脉配制中心配制某患者全静脉营养液时，葡萄糖终浓度计算错误（实际 12%，`
        + '处方要求 8%），配制完成后经复核发现，此时该袋营养液已发放至病区并已开始输注（已输注约 80 mL）。',
      criticality: 'critical', department: '静脉营养液', site: '某医院静脉配制中心（演示）',
      product: '全静脉营养液（个体化处方）', batchNumber: 'PN-2026-0324-07',
      occurredAt: daysAgo(188, 10), detectedAt: daysAgo(188, 11),
      dueDate: dateAgo(174),
    }, U['qa.specialist'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'report', U['qa.specialist'], {
      deviationType: 'calculation_error',
      discoveryContext: '复核药师在核对配制记录时发现葡萄糖投料量与处方不符，向前追溯发现该袋已完成核对并发放。'
        + '立即电话通知病区停止输注。',
      immediateAction: '电话通知病区立即停止输注并保留剩余营养液；药师与医师共同评估患者血糖情况；'
        + '对该批次其他营养液全部暂停发放并重新核对。',
      dispensedToPatient: 'dispensed_and_used',
      patientIdentified: 'identified',
    }, '立即通知病区停止输注');

    step(rec.id, 'containment', U['qa.specialist'], {
      containmentAction: '同批其余 6 袋全部暂停发放，逐袋重新核对配方与投料量；'
        + '该袋剩余营养液封存待检。',
      patientSafetyMeasures: '病区每 2 小时监测血糖，持续 12 小时；监测电解质与渗透压；'
        + '患者未出现高血糖症状，血糖最高 8.9 mmol/L（正常范围），无需额外处理。',
      clinicalNotified: '病区护士长（10:12）、主管医师（10:15），均已确认接收',
      otherBatchesAffected: 'no',
    }, '停用同批并启动患者监测');

    step(rec.id, 'investigation', U['qa.specialist'], {
      batchRecordReview: '批配制记录显示葡萄糖投料量填写为 12% 浓度对应量，与处方要求的 8% 不符。'
        + '记录中「双人独立复核」栏有第二人签名，但经询问，第二人实际未独立重算，仅核对了投料名称后签名。',
      equipmentCheck: '天平 GPP-BAL-01 校准有效期至 2026-11-30，称量记录与投料量一致，设备无异常。',
      materialCheck: '50% 葡萄糖注射液批号 G-2026-0311，效期 2027-09，检验报告齐全，物料无误。',
      environmentalData: '配制间洁净度监测数据正常（沉降菌 ≤1 CFU/皿，尘埃粒子符合万级要求）。',
      rootCause: '配制药师误将 12% 浓度对应量填入记录并实际投料；复核药师未独立重算即签名。'
        + '根本原因是复核环节形同虚设——SOP 要求双人独立复核，但未规定复核人必须重新计算并留存计算过程，'
        + '实际操作中退化为「看一眼签名」。属流程设计缺陷。',
      rootCauseMethod: '5 Whys',
      impactAssessment: '患者已输注约 80 mL 的 12% 葡萄糖营养液，实际葡萄糖输入量约为处方的 1.5 倍。'
        + '患者血糖最高 8.9 mmol/L，无高血糖症状，电解质与渗透压正常。经医师评估对患者无不良影响。'
        + '其余 6 袋经重新核对配方与投料量，均正确，可正常发放。',
      stabilityReference: '该营养液处方效期为 24 小时（2-8℃），本次偏差不影响效期。'
        + '浓度差异对渗透压的影响评估见影响评估部分。',
    }, '根本原因指向复核环节失效');

    const sig = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'disposition',
      '已用于患者的浓度错误经临床评估无不良影响，其余批次核对无误，批准按纠正措施关闭', 'qa_review');
    step(rec.id, 'qa_review', U['qa.manager'], {
      conclusion: '配制浓度计算错误，且复核环节未有效发挥作用，导致错误未在发放前拦截。'
        + '患者已输注但未造成不良影响。根本原因为复核流程设计缺陷。',
      disposition: 'not_applicable_used',
      dispositionBasis: '该袋已输注，无法回收。剩余 6 袋经逐袋核对配方与投料量均正确，判定可正常发放。'
        + '患者经 12 小时监测无不良影响。',
      capaRequired: 'yes',
      capaJustification: '复核环节失效属系统性缺陷，且同类计算差错存在再发可能，必须以 CAPA 解决复核机制设计问题，'
        + '而非仅追究个人责任。',
      patientOutcome: '患者血糖、电解质、渗透压监测正常，无不良事件，营养支持按原计划继续（改用正确浓度配方）。',
      pvReportRequired: 'no',
    }, '判定需 CAPA 解决复核机制', sig);

    const sig2 = signAs(U['qa.manager'], 'workflow_instances', rec.id, rec.recordKey, 'closed',
      '复核机制已重新设计并实施，后续 60 袋配制无计算差错，有效性确认', 'closure');
    step(rec.id, 'closure', U['qa.manager'], {
      correctiveActions: '1. 立即重新培训全体配制与复核药师，明确复核必须独立重算；'
        + '2. 对近 3 个月已配制的 186 袋营养液回顾性核对配方与投料量，未发现其他差错。',
      preventiveActions: '1. 修订 SOP-GPP-001：复核人必须在记录上独立书写计算过程与结果，不得仅签名；'
        + '2. 引入配制计算核对表（含处方浓度、投料量、终浓度三项独立填写）；'
        + '3. 在配制信息系统内增加浓度自动校验，超出处方 ±5% 时强制拦截并需上级确认；'
        + '4. 将「已发放至患者前发现」作为配制环节的关键质量指标纳入月度统计。',
      documentsRevised: 'SOP-GPP-001 修订至 v2.0；新增《静脉营养液配制计算核对表》受控表单',
      trainingDelivered: 'yes',
      effectivenessMethod: '后续 60 袋静脉营养液配制的核对表 100% 检查：计算过程独立书写完整，'
        + '系统自动校验记录显示 0 次拦截触发；回顾性核对 186 袋未发现其他差错；'
        + '连续 3 个月配制环节关键质量指标无「发放后发现问题」事件。',
      effectivenessResult: 'effective',
      trendMonitoring: '配制差错纳入药剂科季度质量分析，关注计算类差错的趋势变化。',
    }, '有效性确认，批准关闭', sig2);

    records['GPP-1'] = rec;
  }

  // --- GPP-2: open stability/OOS issue, past due --------------------------
  {
    const rec = workflow.createInstance({
      processCode: 'GPP-QC',
      title: '制剂效期第 3 个月含量下降至 92.4%（标准 95.0-105.0%）',
      summary: `${MARKER} 某院内制剂（复方口服溶液，批号 P2026-0231）稳定性考察第 3 个月取样检验，`
        + '含量测定结果 92.4%，低于标准下限 95.0%。该制剂标示效期为 6 个月，'
        + '已有 42 瓶发放至门诊药房（其中 18 瓶已发放至患者）。',
      criticality: 'critical', department: '非无菌制剂', site: '某医院药剂科（演示）',
      product: '复方口服溶液 100mL', batchNumber: 'P2026-0231',
      occurredAt: daysAgo(48, 15), detectedAt: daysAgo(46, 9),
      dueDate: dateAgo(25),
    }, U['qc.analyst'], { ip: '127.0.0.1', userAgent: 'seed-demo' });

    step(rec.id, 'lab_investigation', U['qc.analyst'], {
      testMethod: '院内制剂质量标准 ZL-2026-008 含量测定法（HPLC，第 2 版）',
      specification: '95.0% - 105.0% 标示量',
      observedResult: '92.4%',
      rawDataRef: 'HPLC-002 序列号 SEQ-2026-0812-02，图谱文件已归档',
      instrumentUsed: 'HPLC-002（校准有效期至 2026-12-31，有效）；GPP-BAL-01（校准有效期至 2026-11-30，有效）',
      calculationsVerified: '称量 20.08 mg，稀释倍数 50，软件计算参数复核无误；手工复算结果 92.3%，与系统一致。',
      reagentCheck: '对照品批号 RS-2026-005，效期 2027-06；流动相当日新配；色谱柱使用 62 次（限 200 次）。',
      labErrorFound: 'no',
      phase1Conclusion: '未发现实验室差错，计算与仪器均正常，结果有效。进入全面调查。',
    }, '排除实验室差错，结果有效');

    // Left before the full investigation, past due: the recall question (18
    // bottles already with patients) is deliberately unresolved.
    records['GPP-2'] = rec;
  }
  return records;
}

module.exports = { seed, CURRICULA, DOCUMENTS, EQUIPMENT };
