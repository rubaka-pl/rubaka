// Concatenates supabase/migrations/*.sql (in order) into supabase/setup.sql,
// for one-paste setup in the Supabase SQL Editor. Run: node scripts/build-setup-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const body = files.map((f) => `-- ===== ${f} =====\n${readFileSync(`${dir}/${f}`, 'utf8')}`).join('\n\n')
writeFileSync('supabase/setup.sql', `-- RUBAKA — full database setup (generated from supabase/migrations; do not edit by hand)\n-- Paste into Supabase Dashboard -> SQL Editor -> Run. Run once on a new project.\n\n${body}`)
console.log(`supabase/setup.sql written from ${files.length} migrations`)
