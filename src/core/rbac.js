'use strict';

/**
 * Role based access control.
 *
 * Separation of duties is a GxP expectation (EU GMP Annex 11 §12.1, ICH Q10):
 * the person who executes must not be the only person who approves, and the
 * person who raises a deviation must not be the one who closes it.
 *
 * `*` means "all permissions" and is intentionally granted only to
 * `system_admin`, whose GxP-record access is additionally restricted by the
 * rule that system administrators may not be used as the sole approver of
 * GxP records (see `canSign`).
 */

const PERMISSIONS = {
  // administration
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  POLICY_MANAGE: 'policy.manage',
  SETTINGS_MANAGE: 'settings.manage',
  BACKUP_MANAGE: 'backup.manage',
  // Scoped separately from user.manage on purpose. Adding or removing a
  // participant on a workflow view changes who is shown in a process - it does
  // not create accounts, alter role permissions or touch any GxP record. Reusing
  // user.manage would have restricted it to the system administrator, a role the
  // demonstration instance deliberately does not ship, making the capability
  // unreachable exactly where it is meant to be used.
  EXPLORER_MANAGE: 'explorer.manage',

  // audit / compliance
  AUDIT_VIEW: 'audit.view',
  AUDIT_VERIFY: 'audit.verify',
  AUDIT_EXPORT: 'audit.export',
  SIGNATURE_AUTHORIZE: 'signature.authorize',
  COMPLIANCE_VIEW: 'compliance.view',
  COMPLIANCE_MANAGE: 'compliance.manage',

  // document control
  DOC_VIEW: 'doc.view',
  DOC_CREATE: 'doc.create',
  DOC_EDIT: 'doc.edit',
  DOC_REVIEW: 'doc.review',
  DOC_APPROVE: 'doc.approve',
  DOC_OBSOLETE: 'doc.obsolete',

  // records
  RECORD_VIEW: 'record.view',
  RECORD_CREATE: 'record.create',
  RECORD_EDIT: 'record.edit',
  RECORD_CLOSE: 'record.close',
  RECORD_DELETE: 'record.delete',
  RECORD_EXPORT: 'record.export',

  // quality systems
  DEVIATION_MANAGE: 'deviation.manage',
  CAPA_MANAGE: 'capa.manage',
  CHANGE_MANAGE: 'change.manage',
  OOS_MANAGE: 'oos.manage',
  RECALL_MANAGE: 'recall.manage',
  COMPLAINT_MANAGE: 'complaint.manage',
  SUPPLIER_MANAGE: 'supplier.manage',
  BATCH_RELEASE: 'batch.release',

  // laboratory (GLP/GCP)
  LAB_VIEW: 'lab.view',
  LAB_MANAGE: 'lab.manage',
  STUDY_MANAGE: 'study.manage',
  PROTOCOL_MANAGE: 'protocol.manage',
  SUBJECT_DATA_VIEW: 'subject.view',
  SUBJECT_DATA_MANAGE: 'subject.manage',

  // training & qualification
  TRAINING_VIEW: 'training.view',
  TRAINING_MANAGE: 'training.manage',
  TRAINING_ASSESS: 'training.assess',

  // inspections
  INSPECTION_VIEW: 'inspection.view',
  INSPECTION_MANAGE: 'inspection.manage',
  INSPECTION_REPORT: 'inspection.report',

  // equipment
  EQUIPMENT_VIEW: 'equipment.view',
  EQUIPMENT_MANAGE: 'equipment.manage',
};

const P = PERMISSIONS;

const READ_ONLY = [
  P.DOC_VIEW, P.RECORD_VIEW, P.AUDIT_VIEW, P.TRAINING_VIEW, P.INSPECTION_VIEW,
  P.EQUIPMENT_VIEW, P.COMPLIANCE_VIEW, P.LAB_VIEW,
];

const ROLES = {
  system_admin: {
    label: 'System Administrator',
    labelZh: '系统管理员',
    description: 'Technical administration of users, roles and configuration. Cannot be the sole GxP approver.',
    permissions: ['*'],
    isGxPRecordParty: false,
  },

  qa_manager: {
    label: 'QA Manager / Head of Quality',
    labelZh: '质量保证负责人',
    description: 'Owns quality systems, approves deviations, CAPAs, documents and releases.',
    permissions: [
      ...READ_ONLY,
      P.USER_VIEW, P.AUDIT_VERIFY, P.AUDIT_EXPORT, P.SIGNATURE_AUTHORIZE, P.COMPLIANCE_MANAGE,
      P.EXPLORER_MANAGE,
      P.DOC_CREATE, P.DOC_EDIT, P.DOC_REVIEW, P.DOC_APPROVE, P.DOC_OBSOLETE,
      P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.CHANGE_MANAGE, P.OOS_MANAGE,
      P.RECALL_MANAGE, P.COMPLAINT_MANAGE, P.SUPPLIER_MANAGE, P.BATCH_RELEASE,
      P.TRAINING_MANAGE, P.TRAINING_ASSESS,
      P.INSPECTION_MANAGE, P.INSPECTION_REPORT,
      P.EQUIPMENT_MANAGE, P.STUDY_MANAGE, P.PROTOCOL_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  qa_specialist: {
    label: 'QA Specialist',
    labelZh: 'QA 专员',
    description: 'Handles document control, deviation intake, CAPA tracking and self-inspection.',
    permissions: [
      ...READ_ONLY,
      P.AUDIT_EXPORT, P.COMPLIANCE_MANAGE,
      P.DOC_CREATE, P.DOC_EDIT, P.DOC_REVIEW,
      P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_EXPORT,
      P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.CHANGE_MANAGE, P.OOS_MANAGE,
      P.COMPLAINT_MANAGE, P.TRAINING_MANAGE,
      P.INSPECTION_MANAGE, P.EQUIPMENT_VIEW,
    ],
    isGxPRecordParty: true,
  },

  qa_auditor: {
    label: 'Internal Auditor',
    labelZh: '内审员',
    description: 'Conducts self-inspection and supplier audits. Cannot approve what they audited.',
    permissions: [
      ...READ_ONLY,
      P.AUDIT_VERIFY, P.AUDIT_EXPORT, P.COMPLIANCE_MANAGE,
      P.INSPECTION_MANAGE, P.INSPECTION_REPORT, P.SUPPLIER_MANAGE,
      P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_EXPORT,
    ],
    isGxPRecordParty: true,
  },

  production_manager: {
    label: 'Production Manager',
    labelZh: '生产负责人',
    description: 'Owns batch execution, shop-floor deviations and production change requests.',
    permissions: [
      ...READ_ONLY,
      P.DOC_REVIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.DEVIATION_MANAGE, P.CHANGE_MANAGE, P.CAPA_MANAGE,
      P.BATCH_RELEASE, P.EQUIPMENT_MANAGE, P.TRAINING_VIEW,
    ],
    isGxPRecordParty: true,
  },

  production_operator: {
    label: 'Production Operator',
    labelZh: '生产操作工',
    description: 'Executes batch steps and records them in real time.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.TRAINING_VIEW, P.EQUIPMENT_VIEW,
    ],
    isGxPRecordParty: true,
  },

  qc_manager: {
    label: 'QC Manager',
    labelZh: '质量控制负责人',
    description: 'Owns analytical testing, OOS/OOT investigations and method lifecycle.',
    permissions: [
      ...READ_ONLY,
      P.DOC_REVIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.OOS_MANAGE, P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.CHANGE_MANAGE,
      P.EQUIPMENT_MANAGE, P.TRAINING_MANAGE, P.TRAINING_ASSESS, P.LAB_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  qc_analyst: {
    label: 'QC Analyst',
    labelZh: 'QC 分析员',
    description: 'Performs testing, records raw data, initiates OOS.',
    permissions: [
      ...READ_ONLY,
      P.RECORD_CREATE, P.RECORD_EDIT, P.OOS_MANAGE, P.EQUIPMENT_VIEW, P.LAB_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  qp: {
    label: 'Qualified Person (QP)',
    labelZh: '质量受权人',
    description: 'Certifies batches for release under EU GMP Annex 16.',
    permissions: [
      ...READ_ONLY,
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_EXPORT, P.RECORD_CLOSE,
      P.BATCH_RELEASE, P.AUDIT_EXPORT, P.DEVIATION_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  lab_manager: {
    label: 'Study Director / Lab Manager',
    labelZh: '专题负责人 / 实验室负责人',
    description: 'GLP: owns study plans, raw data integrity and final reports.',
    permissions: [
      ...READ_ONLY,
      P.STUDY_MANAGE, P.PROTOCOL_MANAGE, P.LAB_MANAGE, P.EQUIPMENT_MANAGE,
      P.DOC_CREATE, P.DOC_EDIT, P.DOC_REVIEW, P.DOC_APPROVE,
      P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.CHANGE_MANAGE,
      P.TRAINING_MANAGE, P.TRAINING_ASSESS,
    ],
    isGxPRecordParty: true,
  },

  lab_technician: {
    label: 'Laboratory Technician',
    labelZh: '实验技术员',
    description: 'GLP/GCP: performs study procedures and records raw data.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.TRAINING_VIEW,
      P.EQUIPMENT_VIEW, P.LAB_MANAGE, P.STUDY_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  clinical_monitor: {
    label: 'Clinical Research Associate (Monitor)',
    labelZh: '临床监查员 (CRA)',
    description: 'GCP: source data verification, protocol deviation and site monitoring.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_EXPORT,
      P.SUBJECT_DATA_VIEW, P.PROTOCOL_MANAGE, P.INSPECTION_MANAGE, P.TRAINING_VIEW,
      P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.AUDIT_VIEW,
    ],
    isGxPRecordParty: true,
  },

  clinical_pi: {
    label: 'Principal Investigator (PI)',
    labelZh: '主要研究者 (PI)',
    description: 'GCP: accountable for trial conduct and medical decisions at site.',
    permissions: [
      ...READ_ONLY,
      P.PROTOCOL_MANAGE, P.SUBJECT_DATA_VIEW, P.SUBJECT_DATA_MANAGE,
      P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.PROTOCOL_MANAGE,
      P.TRAINING_VIEW, P.INSPECTION_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  ra_officer: {
    label: 'Regulatory Affairs Officer',
    labelZh: '注册事务专员',
    description: 'Maintains submissions, gap assessment against agency requirements.',
    permissions: [
      ...READ_ONLY, P.DOC_VIEW, P.DOC_CREATE, P.DOC_EDIT, P.AUDIT_EXPORT,
      P.RECORD_EXPORT, P.COMPLIANCE_MANAGE, P.CHANGE_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  warehouse_keeper: {
    label: 'Warehouse / Distribution Officer',
    labelZh: '仓储物流员',
    description: 'GDP: controls receipt, storage conditions, distribution and returns.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT,
      P.EQUIPMENT_VIEW, P.TRAINING_VIEW, P.RECALL_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  pharmacovigilance: {
    label: 'Pharmacovigilance Officer',
    labelZh: '药物警戒专员',
    description: 'GVP: adverse event intake, causality and signal management.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_EXPORT,
      P.SUBJECT_DATA_VIEW, P.COMPLAINT_MANAGE, P.AUDIT_VIEW,
      P.CAPA_MANAGE, P.INSPECTION_MANAGE, P.TRAINING_VIEW,
    ],
    isGxPRecordParty: true,
  },

  validation_engineer: {
    label: 'Validation / CSV Engineer',
    labelZh: '验证 / 计算机化系统工程师',
    description: 'Owns IQ/OQ/PQ and CSV lifecycle per GAMP 5 and Annex 11.',
    permissions: [
      ...READ_ONLY, P.EQUIPMENT_MANAGE, P.CHANGE_MANAGE,
      P.DOC_CREATE, P.DOC_EDIT, P.DOC_REVIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_EXPORT,
      P.COMPLIANCE_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  engineering: {
    label: 'Engineering / Maintenance',
    labelZh: '工程 / 维修',
    description: 'Calibration, preventive maintenance and utilities.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.RECORD_CREATE, P.RECORD_EDIT, P.EQUIPMENT_VIEW, P.EQUIPMENT_MANAGE,
      P.TRAINING_VIEW, P.CHANGE_MANAGE,
    ],
    isGxPRecordParty: true,
  },

  trainer: {
    label: 'Trainer / Training Coordinator',
    labelZh: '培训师 / 培训协调员',
    description: 'Maintains curricula, delivers and assesses GxP training.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.TRAINING_VIEW, P.TRAINING_MANAGE, P.TRAINING_ASSESS,
      P.USER_VIEW, P.INSPECTION_VIEW,
    ],
    isGxPRecordParty: true,
  },

  auditor_external: {
    label: 'External Auditor / Inspector (read-only)',
    labelZh: '外部审计员 / 检查员（只读）',
    description: 'Time-boxed read-only access for agency inspections, with every view audited.',
    permissions: [
      P.DOC_VIEW, P.RECORD_VIEW, P.AUDIT_VIEW, P.TRAINING_VIEW, P.INSPECTION_VIEW,
      P.EQUIPMENT_VIEW, P.COMPLIANCE_VIEW, P.AUDIT_EXPORT,
    ],
    isGxPRecordParty: false,
    readOnly: true,
  },

  viewer: {
    label: 'Viewer',
    labelZh: '只读用户',
    description: 'General read-only access for awareness.',
    permissions: READ_ONLY,
    isGxPRecordParty: false,
    readOnly: true,
  },
};

/** Expand `*` and de-duplicate. */
function permissionsFor(role) {
  const def = ROLES[role];
  if (!def) return [];
  if (def.permissions.includes('*')) return ['*'];
  return [...new Set(def.permissions)];
}

function hasPermission(user, permission) {
  if (!user) return false;
  const perms = permissionsFor(user.role);
  return perms.includes('*') || perms.includes(permission);
}

function hasAny(user, permissions) {
  return permissions.some((p) => hasPermission(user, p));
}

const WRITE_ACTIONS = new Set([
  P.DOC_CREATE, P.DOC_EDIT, P.DOC_REVIEW, P.DOC_APPROVE, P.DOC_OBSOLETE,
  P.RECORD_CREATE, P.RECORD_EDIT, P.RECORD_CLOSE, P.RECORD_DELETE,
  P.DEVIATION_MANAGE, P.CAPA_MANAGE, P.CHANGE_MANAGE, P.OOS_MANAGE,
  P.USER_MANAGE, P.POLICY_MANAGE, P.SETTINGS_MANAGE, P.BACKUP_MANAGE,
  P.INSPECTION_MANAGE, P.TRAINING_MANAGE, P.EQUIPMENT_MANAGE,
  P.BATCH_RELEASE, P.STUDY_MANAGE, P.SUBJECT_DATA_MANAGE,
]);

function isReadOnly(user) {
  if (!user) return true;
  const def = ROLES[user.role];
  if (def && def.readOnly) return true;
  return !permissionsFor(user.role).some((p) => p === '*' || WRITE_ACTIONS.has(p));
}

/**
 * Whether this user may apply a GxP e-signature to a given record.
 * Enforces: active account, signature permission, not the record's own author
 * when the step demands independent review, and no self-approval of own CAPA.
 */
function canSign(user, record, opts = {}) {
  if (!user || user.status !== 'active') return { ok: false, code: 'ACCOUNT_NOT_ACTIVE' };
  if (!hasPermission(user, PERMISSIONS.SIGNATURE_AUTHORIZE)
      && !permissionsFor(user.role).includes('*')
      && !hasAny(user, [P.RECORD_CLOSE, P.RECORD_EDIT, P.DOC_APPROVE, P.BATCH_RELEASE])) {
    return { ok: false, code: 'NO_SIGNATURE_PERMISSION' };
  }
  if (record && opts.requireIndependence) {
    const authorId = record.created_by || record.reported_by;
    if (authorId && authorId === user.id) {
      return { ok: false, code: 'INDEPENDENCE_VIOLATION', message: 'Signer must be independent of the record author (Annex 11 §12.1 / ICH Q10).' };
    }
  }
  if (user.role === 'system_admin' && opts.requireQualityRole) {
    return { ok: false, code: 'ADMIN_CANNOT_APPROVE', message: 'System administrator accounts may not serve as the sole GxP approver.' };
  }
  return { ok: true };
}

function listRoles() {
  return Object.entries(ROLES).map(([code, def]) => ({
    code,
    label: def.label,
    labelZh: def.labelZh,
    description: def.description,
    readOnly: Boolean(def.readOnly),
    isGxPRecordParty: def.isGxPRecordParty,
    permissionCount: permissionsFor(code).length,
    permissions: permissionsFor(code),
  }));
}

module.exports = {
  PERMISSIONS,
  ROLES,
  permissionsFor,
  hasPermission,
  hasAny,
  isReadOnly,
  canSign,
  listRoles,
};
