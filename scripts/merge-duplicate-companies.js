// One-off, run by hand: merges existing `company` rows that share the same
// name_normalized (duplicates created before the getOrCreateCompany fix, one
// per domain variant the same real-world company was ingested under).
// Picks the oldest row per group as canonical, repoints job.company_id to
// it, then deletes the duplicate rows. Prints what it's about to do first —
// review the list before it deletes anything from production data.
//
// Usage:
//   node scripts/merge-duplicate-companies.js            # dry run, prints only
//   node scripts/merge-duplicate-companies.js --apply     # actually merges

import { db } from '../src/db/index.js';

const apply = process.argv.includes('--apply');

async function main() {
  const { rows: groups } = await db.query(`
    SELECT name_normalized, array_agg(id ORDER BY created_at ASC) AS ids, array_agg(name ORDER BY created_at ASC) AS names
    FROM company
    WHERE name_normalized IS NOT NULL AND name_normalized != ''
    GROUP BY name_normalized
    HAVING count(*) > 1
  `);

  if (groups.length === 0) {
    console.log('No duplicate companies found.');
    return;
  }

  console.log(`Found ${groups.length} groups of duplicate companies:\n`);
  for (const g of groups) {
    const [canonicalId, ...dupeIds] = g.ids;
    console.log(`  "${g.names[0]}" (id=${canonicalId}, keeping) <- duplicates: ${g.names.slice(1).map((n, i) => `"${n}" (id=${dupeIds[i]})`).join(', ')}`);
  }

  if (!apply) {
    console.log('\nDry run only — pass --apply to actually merge.');
    return;
  }

  console.log('\nApplying merges...');
  for (const g of groups) {
    const [canonicalId, ...dupeIds] = g.ids;
    const jobsMoved = await db.query(
      `UPDATE job SET company_id = $1 WHERE company_id = ANY($2::bigint[])`,
      [canonicalId, dupeIds]
    );
    await db.query(`DELETE FROM company WHERE id = ANY($1::bigint[])`, [dupeIds]);
    console.log(`  merged into id=${canonicalId}: moved ${jobsMoved.rowCount} jobs, deleted ${dupeIds.length} duplicate company rows`);
  }
  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
