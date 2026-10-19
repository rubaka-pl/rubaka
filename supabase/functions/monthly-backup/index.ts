/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 *
 * monthly-backup — builds a full RUBAKA backup (same format as Settings →
 * Export, restorable via Settings → Restore) and e-mails it as a .json.gz
 * attachment through Resend.
 *
 * Called by:
 *   - pg_cron once a month, with header  x-backup-secret: <BACKUP_SECRET>
 *   - the app ("Send me a backup now"), with the owner's session JWT
 *
 * To stay within the Edge Function CPU budget it never parses the data: it
 * streams PostgREST pages as text straight into a gzip stream.
 *
 * Secrets: RESEND_API_KEY, BACKUP_SECRET, BACKUP_EMAIL
 * (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.)
 * Deploy with JWT verification OFF (the function checks access itself).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-backup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

// Restore order of the app's backup format (src/features/settings/backup.ts).
const TABLES: { name: string; source?: string; order: string }[] = [
  { name: 'media', order: 'id' },
  { name: 'media_titles', order: 'id' },
  { name: 'media_external_ids', order: 'provider,external_id' },
  { name: 'media_seasons', order: 'media_id,season_number' },
  { name: 'media_relations', order: 'id' },
  { name: 'library_entries', order: 'id' },
  { name: 'entry_season_progress', order: 'entry_id,season_number' },
  { name: 'tracking_sessions', order: 'id' },
  { name: 'vn_routes', order: 'id' },
  { name: 'activity_log', order: 'id' },
  { name: 'user_settings', order: 'user_id' },
  { name: 'media_genres', source: 'media_genres_named', order: 'media_id,genre' },
]
const PAGE = 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const secret = Deno.env.get('BACKUP_SECRET')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const to = Deno.env.get('BACKUP_EMAIL')
  if (!resendKey || !to) return json({ error: 'RESEND_API_KEY / BACKUP_EMAIL are not set' }, 501)

  // Access: the monthly schedule (shared secret) or the signed-in owner.
  const viaCron = !!secret && req.headers.get('x-backup-secret') === secret
  if (!viaCron) {
    const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
    const { data: isOwner } = await sb.rpc('am_i_owner')
    if (!isOwner) return json({ error: 'Forbidden' }, 403)
  }

  try {
    const date = new Date().toISOString().slice(0, 10)
    const gzip = new CompressionStream('gzip')
    const writer = gzip.writable.getWriter()
    const enc = new TextEncoder()
    const zipped = new Response(gzip.readable).arrayBuffer()
    const counts: Record<string, number> = {}

    await writer.write(enc.encode(`{"format":"rubaka-backup","version":1,"app":"RUBAKA","exported_at":"${new Date().toISOString()}","scope":"full","source":"monthly-backup","tables":{`))
    for (let t = 0; t < TABLES.length; t++) {
      const { name, source, order } = TABLES[t]
      await writer.write(enc.encode(`${t ? ',' : ''}"${name}":[`))
      let n = 0
      for (let from = 0; ; from += PAGE) {
        const res = await fetch(`${url}/rest/v1/${source ?? name}?select=*&order=${order}`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
        })
        if (res.status === 416) break // past the last row (row count was an exact multiple of PAGE)
        if (!res.ok && res.status !== 206) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
        const text = (await res.text()).trim()
        const inner = text.slice(1, -1).trim() // strip [ ]
        if (!inner) break
        await writer.write(enc.encode((n ? ',' : '') + inner))
        // Rows on this page = top-level objects; count cheaply via the Content-Range header.
        const range = res.headers.get('content-range') // e.g. "0-999/*"
        const got = range ? Number(range.split('/')[0].split('-')[1]) - Number(range.split('-')[0]) + 1 : PAGE
        n += got
        if (got < PAGE) break
      }
      counts[name] = n
      await writer.write(enc.encode(']'))
    }
    await writer.write(enc.encode(`},"counts":${JSON.stringify(counts)}}`))
    await writer.close()
    const bytes = new Uint8Array(await zipped)

    const filename = `rubaka-backup-${date}.json.gz`
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'RUBAKA <onboarding@resend.dev>',
        to: [to],
        subject: `RUBAKA backup ${date}`,
        html: `<p>Your ${viaCron ? 'monthly' : 'requested'} RUBAKA backup is attached (${counts.library_entries ?? 0} library entries, ${(bytes.length / 1e6).toFixed(1)} MB compressed).</p>
<p>To restore: unzip if needed, then RUBAKA → Settings → Restore. The .json.gz file can also be restored directly.</p>`,
        attachments: [{ filename, content: encodeBase64(bytes) }],
      }),
    })
    if (!mail.ok) throw new Error(`Resend: HTTP ${mail.status} ${(await mail.text()).slice(0, 300)}`)
    return json({ ok: true, to, filename, bytes: bytes.length, counts })
  } catch (err) {
    console.error('monthly-backup failed', err)
    return json({ error: (err as Error).message }, 500)
  }
})
