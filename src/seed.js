'use strict';

/**
 * Seed loader.
 *
 * Two distinct things are loaded at start-up:
 *
 *  1. The **GxP configuration library** - process-type definitions and
 *     inspection checklist templates. These are configuration, not data: they
 *     describe how the site's quality system works and are version controlled
 *     alongside the code. They are (re)loaded on every start so editing a JSON
 *     file is enough to change a workflow.
 *
 *  2. Reference data - the GxP area register. Loaded once, then left alone.
 *
 * Demo records are deliberately NOT loaded here; `scripts/seed-demo.js` does
 * that explicitly, so a production instance never accidentally gets fake
 * deviations in its audit trail.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const db = require('./core/db');
const workflow = require('./domain/workflow');
const inspections = require('./domain/inspections');

function nowIso() { return new Date().toISOString(); }

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${err.message}`);
  }
}

/**
 * The GxP area register. Each entry is a domain of good practice with its own
 * regulatory basis; the workbench treats them uniformly, which is what lets one
 * codebase serve a GMP plant, a GLP lab and a GCP trial site.
 */
const GXP_AREAS = [
  {
    code: 'GMP', name: '药品生产质量管理规范', nameEn: 'Good Manufacturing Practice',
    fullName: 'Good Manufacturing Practice', fullNameEn: 'Good Manufacturing Practice',
    description: 'Production and quality control of medicinal products. Basis: EU GMP Guide, 21 CFR Parts 210/211, NMPA GMP (2010 revision), WHO TRS 986 Annex 2.',
    colour: '#2563eb',
  },
  {
    code: 'GLP', name: '药物非临床研究质量管理规范', nameEn: 'Good Laboratory Practice',
    fullName: 'Good Laboratory Practice', fullNameEn: 'Good Laboratory Practice',
    description: 'Non-clinical safety studies. Basis: OECD Principles of GLP (ENV/MC/CHEM(98)17), 21 CFR Part 58, NMPA GLP.',
    colour: '#7c3aed',
  },
  {
    code: 'GCP', name: '药物临床试验质量管理规范', nameEn: 'Good Clinical Practice',
    fullName: 'Good Clinical Practice', fullNameEn: 'Good Clinical Practice',
    description: 'Clinical trials involving human subjects. Basis: ICH E6(R2)/(R3), 21 CFR Parts 50/56/312, NMPA GCP (2020).',
    colour: '#0891b2',
  },
  {
    code: 'GVP', name: '药物警戒质量管理规范', nameEn: 'Good Pharmacovigilance Practice',
    fullName: 'Good Pharmacovigilance Practice', fullNameEn: 'Good Pharmacovigilance Practice',
    description: 'Post-authorisation safety monitoring. Basis: EU GVP modules, ICH E2 series, NMPA GVP (2021).',
    colour: '#db2777',
  },
  {
    code: 'GDP', name: '药品经营质量管理规范', nameEn: 'Good Distribution Practice',
    fullName: 'Good Distribution Practice', fullNameEn: 'Good Distribution Practice',
    description: 'Storage, transport and distribution. Basis: EU GDP Guidelines 2013/C 343/01, WHO TRS 957 Annex 5, NMPA GSP.',
    colour: '#ea580c',
  },
  {
    code: 'GPP', name: '医疗机构制剂配制质量管理规范', nameEn: 'Good Pharmacy / Preparation Practice',
    fullName: 'Good Pharmacy Practice / Hospital Preparation', fullNameEn: 'Good Pharmacy Practice',
    description: 'Pharmacy compounding and hospital preparation. Basis: WHO GPP, NMPA 医疗机构制剂配制质量管理规范.',
    colour: '#16a34a',
  },
  {
    code: 'GAMP', name: '计算机化系统验证', nameEn: 'Computerised System Validation (GAMP 5)',
    fullName: 'Good Automated Manufacturing Practice', fullNameEn: 'GAMP 5 Computerised Systems',
    description: 'Validation and control of computerised systems. Basis: ISPE GAMP 5 (2nd ed.), EU GMP Annex 11, 21 CFR Part 11, NMPA 计算机化系统附录.',
    colour: '#475569',
  },
  {
    code: 'GDPR-DataIntegrity', name: '数据完整性', nameEn: 'Data Integrity (ALCOA+)',
    fullName: 'Data Integrity', fullNameEn: 'Data Integrity',
    description: 'Cross-cutting data governance. Basis: WHO TRS 1033 Annex 4, PIC/S PI 041, MHRA GxP Data Integrity Guidance 2018.',
    colour: '#0f766e',
  },
];

function loadGxpAreas() {
  const at = nowIso();
  let added = 0;
  GXP_AREAS.forEach((area, index) => {
    const existing = db.get('SELECT code FROM gxp_areas WHERE code = ?', [area.code]);
    db.run(
      'INSERT INTO gxp_areas (code, name, name_en, full_name, full_name_en, description, colour, sort_order) ' +
      'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, name_en = excluded.name_en, ' +
      'full_name = excluded.full_name, full_name_en = excluded.full_name_en, description = excluded.description, ' +
      'colour = excluded.colour, sort_order = excluded.sort_order',
      [area.code, area.name, area.nameEn, area.fullName, area.fullNameEn, area.description, area.colour, index + 1]
    );
    if (!existing) added += 1;
  });
  return { total: GXP_AREAS.length, added };
}

function loadProcessTypes() {
  const dir = path.join(config.seedDir, 'workflows');
  const files = listJsonFiles(dir);
  const loaded = [];
  const errors = [];
  for (const file of files) {
    try {
      const definition = readJson(file);
      const result = workflow.register(definition, path.basename(file));
      loaded.push({ code: result.code, file: path.basename(file), changed: result.changed });
    } catch (err) {
      errors.push({ file: path.basename(file), message: err.message });
    }
  }
  // Deactivate process types whose definition file was removed, so a deleted
  // workflow stops appearing rather than silently persisting.
  const knownFiles = new Set(files.map((f) => path.basename(f)));
  const allRows = db.all('SELECT code, source_file FROM process_types WHERE active = 1');
  const orphaned = allRows.filter((r) => r.source_file && !knownFiles.has(r.source_file));
  for (const row of orphaned) {
    db.run('UPDATE process_types SET active = 0 WHERE code = ?', [row.code]);
  }
  return { loaded, errors, deactivated: orphaned.length };
}

function loadChecklistTemplates() {
  const dir = path.join(config.seedDir, 'checklists');
  const files = listJsonFiles(dir);
  const loaded = [];
  const errors = [];
  for (const file of files) {
    try {
      const template = readJson(file);
      const result = inspections.registerTemplate(template, path.basename(file));
      loaded.push({ code: result.code, file: path.basename(file), items: result.items });
    } catch (err) {
      errors.push({ file: path.basename(file), message: err.message });
    }
  }
  const knownFiles = new Set(files.map((f) => path.basename(f)));
  const allRows = db.all('SELECT code, source_file FROM checklist_templates WHERE active = 1');
  const orphaned = allRows.filter((r) => r.source_file && !knownFiles.has(r.source_file));
  for (const row of orphaned) {
    db.run('UPDATE checklist_templates SET active = 0 WHERE code = ?', [row.code]);
  }
  return { loaded, errors, deactivated: orphaned.length };
}

/**
 * Run the whole seed process.
 * @param {object} [opts]
 * @param {boolean} [opts.silent] suppress console output (used at start-up)
 * @param {boolean} [opts.throwOnError] fail hard instead of reporting
 */
function run(opts = {}) {
  const hadConfig = db.get('SELECT COUNT(*) AS n FROM process_types').n > 0;
  const areas = loadGxpAreas();
  const processes = loadProcessTypes();
  const checklists = loadChecklistTemplates();

  const errors = [...processes.errors, ...checklists.errors];
  if (errors.length && opts.throwOnError) {
    throw new Error(errors.map((e) => `${e.file}: ${e.message}`).join('; '));
  }

  const summary = {
    bootstrapped: !hadConfig,
    gxpAreas: areas.total,
    processTypes: processes.loaded.length,
    checklistTemplates: checklists.loaded.length,
    checklistItems: checklists.loaded.reduce((a, b) => a + b.items, 0),
    errors,
  };

  if (!opts.silent) {
    process.stdout.write(`\n  GxP configuration library\n`);
    process.stdout.write(`    GxP areas            ${summary.gxpAreas}\n`);
    process.stdout.write(`    Process types        ${summary.processTypes}\n`);
    process.stdout.write(`    Checklist templates  ${summary.checklistTemplates} (${summary.checklistItems} requirements)\n`);
    if (processes.deactivated) process.stdout.write(`    Deactivated          ${processes.deactivated} removed process type(s)\n`);
    if (checklists.deactivated) process.stdout.write(`    Deactivated          ${checklists.deactivated} removed checklist(s)\n`);
    if (errors.length) {
      process.stdout.write('\n  WARNINGS while loading configuration:\n');
      for (const e of errors) process.stdout.write(`    ${e.file}: ${e.message}\n`);
    }
    process.stdout.write('\n');
  } else if (errors.length) {
    process.stdout.write(`  [seed] ${errors.length} configuration file(s) failed to load:\n`);
    for (const e of errors) process.stdout.write(`         ${e.file}: ${e.message}\n`);
  }

  return summary;
}

module.exports = { run, GXP_AREAS };
