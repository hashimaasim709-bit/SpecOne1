// First-run seeding. Runs once per database (guarded by an atomic flag) right after the
// schema migration, so a fresh deployment comes up with a complete, editable catalogue.
import { run, stmt } from '../lib/db';
import { BANNERS, CHATBOT_RULES, FAQS, GUIDES, TOWNS } from './content';
import { INVENTORY, LICENCES, LOCATION, PACKAGES, PARTNERS, PLANS, PRICING_RULES, PROMOS, UPSELLS, VAN } from './catalog';
import { CHECKLISTS, CODING_MATRIX, DTC_CODES, TECH_GUIDES, TORQUE_SPECS, WIRING_REFS } from './technical';

const SEED_VERSION = '1';

function inserts(db: D1Database, table: string, rows: Record<string, unknown>[]): D1PreparedStatement[] {
  return rows.map((row) => {
    const cols = Object.keys(row);
    return stmt(db, `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...(Object.values(row) as (string | number | null)[]));
  });
}

async function batched(db: D1Database, statements: D1PreparedStatement[], size = 40): Promise<void> {
  for (let i = 0; i < statements.length; i += size) await db.batch(statements.slice(i, i + size));
}

export async function seedDatabase(db: D1Database): Promise<void> {
  // Claim the flag atomically: only one isolate ever proceeds past this line.
  const claim = await run(db, "INSERT INTO settings (key, value) VALUES ('flag:seed_version', ?) ON CONFLICT(key) DO NOTHING", SEED_VERSION);
  if (!claim.changes) return;
  try {
    await db.batch(inserts(db, 'locations', [LOCATION]));
    await batched(db, [
      ...inserts(db, 'vans', [VAN]),
      ...inserts(db, 'packages', PACKAGES),
      ...inserts(db, 'plans', PLANS),
      ...inserts(db, 'upsell_rules', UPSELLS),
      ...inserts(db, 'pricing_rules', PRICING_RULES),
      ...inserts(db, 'promo_codes', PROMOS),
      ...inserts(db, 'partners', PARTNERS),
      ...inserts(db, 'inventory', INVENTORY),
      ...inserts(db, 'licences', LICENCES),
    ]);
    await batched(db, [
      ...inserts(db, 'banners', BANNERS),
      ...inserts(db, 'faqs', FAQS.map((f, i) => ({ ...f, sort: (i + 1) * 10 }))),
      ...inserts(db, 'towns', TOWNS),
      ...inserts(db, 'guides', GUIDES),
      ...inserts(db, 'chatbot_rules', CHATBOT_RULES),
    ]);
    await batched(db, [
      ...inserts(db, 'dtc_codes', DTC_CODES),
      ...inserts(db, 'coding_matrix', CODING_MATRIX),
      ...inserts(db, 'torque_specs', TORQUE_SPECS),
      ...inserts(db, 'wiring_refs', WIRING_REFS),
      ...inserts(db, 'tech_guides', TECH_GUIDES),
      ...inserts(db, 'checklist_templates', CHECKLISTS),
    ]);
  } catch (err) {
    await run(db, "DELETE FROM settings WHERE key = 'flag:seed_version'");
    throw err;
  }
}
