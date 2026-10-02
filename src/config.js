'use strict';

/**
 * Central runtime configuration.
 *
 * Everything is overridable through environment variables so the same build can
 * run on a workstation, a lab bench PC or a shared workshop terminal without
 * code changes.
 */

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = process.env.GXP_DATA_DIR
  ? path.resolve(process.env.GXP_DATA_DIR)
  : path.join(ROOT, 'data');

for (const dir of [dataDir, path.join(ROOT, 'exports'), path.join(ROOT, 'backups')]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const config = {
  app: {
    name: 'LeebertyGXP',
    nameZh: 'LeebertyGXP',
    version: require('../package.json').version,
    /** Schema version, stamped into every database for upgrade bookkeeping. */
    schemaVersion: 1,
  },

  root: ROOT,
  dataDir,
  exportDir: path.join(ROOT, 'exports'),
  backupDir: path.join(ROOT, 'backups'),
  webDir: path.join(ROOT, 'web'),
  seedDir: path.join(ROOT, 'seed'),
  dbFile: process.env.GXP_DB_FILE
    ? path.resolve(process.env.GXP_DB_FILE)
    : path.join(dataDir, 'gxp.db'),

  http: {
    host: process.env.GXP_HOST || '127.0.0.1',
    port: envInt('GXP_PORT', 8788),
    /** Set GXP_TRUST_PROXY=1 when published behind a reverse proxy. */
    trustProxy: process.env.GXP_TRUST_PROXY === '1',
    maxBodyBytes: envInt('GXP_MAX_BODY', 8 * 1024 * 1024),
  },

  security: {
    // --- 21 CFR Part 11.300(b): periodic password checks -------------------
    passwordMinLength: envInt('GXP_PASSWORD_MIN', 10),
    passwordHistoryDepth: envInt('GXP_PASSWORD_HISTORY', 5),
    passwordMaxAgeDays: envInt('GXP_PASSWORD_MAX_AGE', 90),
    passwordRequireClasses: envInt('GXP_PASSWORD_CLASSES', 3),
    // --- 21 CFR Part 11.10(d): limiting system access ----------------------
    maxFailedLogins: envInt('GXP_MAX_FAILED_LOGINS', 5),
    lockoutMinutes: envInt('GXP_LOCKOUT_MINUTES', 15),
    // --- 21 CFR Part 11.10(d) / Annex 11 §12: session control --------------
    idleTimeoutMinutes: envInt('GXP_IDLE_TIMEOUT', 30),
    sessionAbsoluteHours: envInt('GXP_SESSION_ABSOLUTE_HOURS', 12),
    // --- 21 CFR Part 11.200(a)(1)(i): two distinct identification components
    signatureTtlMinutes: envInt('GXP_SIGNATURE_TTL', 5),
    signingNonceTtlSeconds: envInt('GXP_NONCE_TTL', 120),
    totpIssuer: 'LeebertyGXP',
  },

  /** Days ahead that "expiring soon" warnings cover. */
  reminder: {
    documentReviewWarningDays: envInt('GXP_DOC_REVIEW_WARN_DAYS', 30),
    trainingExpiryWarningDays: envInt('GXP_TRAINING_WARN_DAYS', 30),
    calibrationWarningDays: envInt('GXP_CALIBRATION_WARN_DAYS', 30),
    capaDueWarningDays: envInt('GXP_CAPA_WARN_DAYS', 7),
  },

  /** Chain verification uses a keyed digest so audit rows cannot be recomputed
   *  by someone who merely copies the database file. */
  audit: {
    get hmacKey() {
      const f = path.join(dataDir, 'audit-chain.key');
      if (!fs.existsSync(f)) {
        fs.writeFileSync(f, require('node:crypto').randomBytes(48).toString('hex'), { mode: 0o600 });
      }
      return fs.readFileSync(f, 'utf8').trim();
    },
  },

  /** Runtime feature switches, also editable from the UI settings page. */
  features: {
    /** Require a TOTP code (second factor) for GxP-relevant e-signatures. */
    signatureSecondFactor: process.env.GXP_SIG_2FA !== '0',
    /** Block completion of records whose linked steps are incomplete. */
    strictWorkflowGating: process.env.GXP_STRICT_GATING !== '0',
    /** Refuse mutations when the audit chain is broken. */
    freezeOnChainBreak: process.env.GXP_FREEZE_ON_CHAIN_BREAK !== '0',
    /**
     * Provision the built-in demonstration personas at start-up and show them on
     * the login screen. OFF by default: an instance that will hold real GxP
     * records must never ship with known credentials. Enable with
     * GXP_BUILTIN_ACCOUNTS=1 for a click-and-use instance.
     */
    builtinAccounts: process.env.GXP_BUILTIN_ACCOUNTS === '1',
    /**
     * Generate the demonstration dataset at start-up when the instance holds no
     * GxP records yet, so one double-click gives a populated workbench instead of
     * an empty shell plus instructions to run a second script.
     *
     * Gated on built-in accounts as well: the dataset is fictional deviations,
     * CAPAs and signatures written into the real audit trail, and it must never
     * appear in an instance that will hold real records. GXP_AUTO_SEED_DEMO=0
     * turns it off for a demonstration instance that should stay empty.
     */
    autoSeedDemo: process.env.GXP_AUTO_SEED_DEMO !== '0'
      && process.env.GXP_BUILTIN_ACCOUNTS === '1',
    /** Run the background workflow monitor as a child of the server process. */
    backgroundMonitor: process.env.GXP_MONITOR !== '0',
  },
};

module.exports = config;
