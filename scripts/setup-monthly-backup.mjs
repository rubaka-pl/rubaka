// Generates supabase/backup-schedule.local.sql (git-ignored) with a fresh random
// secret: paste it into Supabase → SQL Editor once, and put the same secret into
// Edge Functions → Secrets as BACKUP_SECRET. Run: node scripts/setup-monthly-backup.mjs
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  (existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  console.error('VITE_SUPABASE_URL in .env.local must be https://<ref>.supabase.co')
  process.exit(1)
}
const secret = randomBytes(24).toString('base64url')
const sql = `-- RUBAKA monthly e-mail backup schedule (generated ${new Date().toISOString().slice(0, 10)}).
-- Contains a secret: do not commit or share. Run once in Supabase → SQL Editor.
-- Then add the SAME value as an Edge Function secret:  BACKUP_SECRET = ${secret}

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Store the secret in Supabase Vault (encrypted), replacing an older one.
delete from vault.secrets where name = 'rubaka_backup_secret';
select vault.create_secret('${secret}', 'rubaka_backup_secret');

-- 06:00 UTC on the 1st of every month.
select cron.unschedule('rubaka-monthly-backup') where exists (select 1 from cron.job where jobname = 'rubaka-monthly-backup');
select cron.schedule('rubaka-monthly-backup', '0 6 1 * *', $job$
  select net.http_post(
    url := '${url}/functions/v1/monthly-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'rubaka_backup_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);

select jobname, schedule, active from cron.job where jobname = 'rubaka-monthly-backup';
`
writeFileSync('supabase/backup-schedule.local.sql', sql)
console.log('Wrote supabase/backup-schedule.local.sql (contains your BACKUP_SECRET; git-ignored).')
