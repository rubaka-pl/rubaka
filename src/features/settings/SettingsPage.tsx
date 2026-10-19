/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileJson, LoaderCircle, LogOut, Sheet, TriangleAlert, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Field, Input, Label, Switch } from '@/components/ui/form-controls'
import { Badge, ErrorState, ProgressBar } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/features/auth/auth'
import { invalidateLibrary } from '@/features/tracking/api'
import { getProxyStatus } from '@/integrations/proxied'
import { CATEGORY_LIST } from '@/lib/categories'
import { formatDate, formatTimestamp, TIMEZONES } from '@/lib/dates'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { downloadFile } from '@/lib/utils'
import type { MediaCategory } from '@/types/db'
import { backupToCsv, currentCounts, exportBackup, parseBackup, restoreBackup, type Backup } from './backup'
import { saveSettings, SORT_OPTIONS, useSettings, type Settings } from './settings-store'

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-6 md:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-fg-3">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const s = useSettings()
  const save = (patch: Partial<Settings>) => saveSettings(patch).then(() => toast.success('Saved'), (e) => toast.error(friendlyError(e)))
  const proxy = useQuery({ queryKey: ['proxy-status'], queryFn: () => getProxyStatus(true), staleTime: 60_000 })

  return (
    <PageContainer className="max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <Section title="Account" description="RUBAKA is private. There is no public registration.">
        <div className="grid gap-1 text-[13px]">
          <div><span className="text-fg-3">Email:</span> {user?.email}</div>
          <div className="break-all"><span className="text-fg-3">User id:</span> <code className="text-xs">{user?.id}</code></div>
          <div><span className="text-fg-3">Signed in since:</span> {formatTimestamp(user?.last_sign_in_at, true)}</div>
        </div>
        <Button className="self-start" variant="secondary" onClick={() => void signOut()}><LogOut /> Sign out</Button>
      </Section>

      <Section title="Appearance">
        <Field label="Theme" htmlFor="set-theme">
          <Select id="set-theme" value={s.theme} onValueChange={(v) => void save({ theme: v as Settings['theme'] })} className="w-48" options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
        </Field>
      </Section>

      <Section title="Interface" description="Defaults for library pages. View mode can also be changed per category.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default sort" htmlFor="set-sort">
            <Select id="set-sort" value={s.defaultSort} onValueChange={(v) => void save({ defaultSort: v })} options={SORT_OPTIONS} />
          </Field>
          <Field label="Default view / grid density" htmlFor="set-view">
            <Select id="set-view" value={s.defaultView} onValueChange={(v) => void save({ defaultView: v as Settings['defaultView'] })} options={[{ value: 'grid', label: 'Poster grid' }, { value: 'compact', label: 'Compact grid' }, { value: 'list', label: 'List' }]} />
          </Field>
          <Field label="Date format" htmlFor="set-date" hint={`Example: ${formatDate('2026-03-12', s.dateFormat)}`}>
            <Select id="set-date" value={s.dateFormat} onValueChange={(v) => void save({ dateFormat: v as Settings['dateFormat'] })} options={[
              { value: 'medium', label: '12 Mar 2026' }, { value: 'long', label: '12 March 2026' }, { value: 'numeric', label: '12/03/2026' }, { value: 'iso', label: '2026-03-12' },
            ]} />
          </Field>
          <Field label="Timezone" htmlFor="set-tz" hint="Used for activity times, “today” and statistics.">
            <Select id="set-tz" value={s.timezone} onValueChange={(v) => void save({ timezone: v })} options={TIMEZONES.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="When you start a wishlisted title" htmlFor="set-wish">
            <Select id="set-wish" value={s.wishlistOnStart} onValueChange={(v) => void save({ wishlistOnStart: v as Settings['wishlistOnStart'] })} options={[
              { value: 'ask', label: 'Ask (offer to remove)' }, { value: 'keep', label: 'Keep in wishlist' }, { value: 'remove', label: 'Remove from wishlist' },
            ]} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-1 text-[13px]">
            <Switch checked={s.fillProgressOnComplete} onCheckedChange={(v) => void save({ fillProgressOnComplete: v })} />
            Fill progress to the known total when marking completed
          </label>
        </div>
      </Section>

      <Section title="Metadata providers" description="Keyless providers work out of the box. TMDB and IGDB need secrets on the server (never in this app's code).">
        <ul className="flex flex-col gap-1.5 text-[13px]">
          <li className="flex items-center gap-2"><Badge tone="success">Ready</Badge> AniList — anime, manga, light novels</li>
          <li className="flex items-center gap-2"><Badge tone="success">Ready</Badge> VNDB — visual novels</li>
          <li className="flex items-center gap-2"><Badge tone="success">Ready</Badge> TVMaze — TV and animated series</li>
          <li className="flex items-center gap-2"><Badge tone="success">Ready</Badge> Open Library — novels</li>
          <li className="flex items-center gap-2">{proxy.isLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Badge tone={proxy.data?.tmdb ? 'success' : 'warning'}>{proxy.data?.tmdb ? 'Ready' : 'Not configured'}</Badge>} TMDB — movies (posters, synopses), TV</li>
          <li className="flex items-center gap-2">{proxy.isLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Badge tone={proxy.data?.igdb ? 'success' : 'warning'}>{proxy.data?.igdb ? 'Ready' : 'Not configured'}</Badge>} IGDB — games</li>
          <li className="flex items-center gap-2">{proxy.isLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Badge tone={proxy.data?.mal ? 'success' : 'default'}>{proxy.data?.mal ? 'Ready' : 'Optional'}</Badge>} MyAnimeList — fallback for anime/manga missing on AniList</li>
        </ul>
        <p className="text-xs text-fg-3">
          To enable TMDB/IGDB, deploy the <code>metadata-proxy</code> Edge Function and set <code>TMDB_READ_TOKEN</code>, <code>TWITCH_CLIENT_ID</code> and <code>TWITCH_CLIENT_SECRET</code> (and optionally <code>MAL_CLIENT_ID</code>) as Supabase secrets — see README → “Metadata providers”.
        </p>
        <Button asChild variant="secondary" className="self-start"><Link to="/import">Open metadata queue</Link></Button>
      </Section>

      <Section title="Export" description="Your data, independent of Supabase. The full JSON backup can be restored here.">
        <ExportControls />
      </Section>

      <Section title="Restore" description="Restore from a RUBAKA JSON backup. You will see a preview before anything changes.">
        <RestoreControls />
      </Section>

      <Section title="Danger zone">
        <DeleteLibrary />
      </Section>
      <p className="py-6 text-center text-xs text-fg-3">RUBAKA · Created by RUBAKA © 2026</p>
    </PageContainer>
  )
}

function ExportControls() {
  const [scope, setScope] = useState<'full' | MediaCategory>('full')
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (kind: 'json' | 'csv') => {
    setBusy('Preparing…')
    try {
      const b = await exportBackup(scope, (m) => setBusy(`Reading ${m.replace(/_/g, ' ')}…`))
      const date = new Date().toISOString().slice(0, 10)
      const name = `rubaka-${scope === 'full' ? 'backup' : scope}-${date}`
      if (kind === 'json') downloadFile(JSON.stringify(b), `${name}.json`)
      else downloadFile(backupToCsv(b), `${name}.csv`, 'text/csv')
      toast.success(`Exported ${b.counts.media ?? 0} titles`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Scope" htmlFor="exp-scope">
          <Select id="exp-scope" value={scope} onValueChange={(v) => setScope(v as typeof scope)} className="w-52" options={[{ value: 'full', label: 'Everything (full backup)' }, ...CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))]} />
        </Field>
        <Button onClick={() => void run('json')} disabled={!!busy}><FileJson /> JSON</Button>
        <Button onClick={() => void run('csv')} disabled={!!busy}><Sheet /> CSV</Button>
      </div>
      {busy && <p className="flex items-center gap-2 text-xs text-fg-3"><LoaderCircle className="size-3.5 animate-spin" /> {busy}</p>}
      <p className="text-xs text-fg-3">JSON includes metadata, ids, statuses, ratings, progress, sessions, wishlist, favorites, notes and dates. CSV is a flat table for spreadsheets (not restorable).</p>
    </div>
  )
}

function RestoreControls() {
  const qc = useQueryClient()
  const [backup, setBackup] = useState<Backup | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [confirmText, setConfirmText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [progress, setProgress] = useState<{ msg: string; done: number; total: number } | null>(null)
  const counts = useQuery({ queryKey: ['current-counts'], queryFn: currentCounts, enabled: !!backup })

  const onFile = async (f: File) => {
    setError(null); setBackup(null)
    const res = parseBackup(await f.text())
    if ('error' in res) setError(res.error)
    else { setBackup(res.backup); setFileName(f.name) }
  }
  const safetyBackup = async () => {
    const b = await exportBackup('full')
    downloadFile(JSON.stringify(b), `rubaka-backup-before-restore-${new Date().toISOString().slice(0, 10)}.json`)
  }
  const run = async () => {
    if (!backup) return
    try {
      const res = await restoreBackup(backup, mode, (msg, done, total) => setProgress({ msg, done, total }))
      toast.success(`Restored: ${res.media ?? 0} titles, ${res.library_entries ?? 0} entries, ${res.tracking_sessions ?? 0} sessions`)
      setBackup(null)
      invalidateLibrary(qc)
      qc.invalidateQueries({ queryKey: ['current-counts'] })
    } catch (e) {
      toast.error(`Restore failed: ${friendlyError(e)}`)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] hover:border-line-strong">
        <Upload className="size-4" /> Choose backup file…
        <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
      </label>
      {error && <ErrorState error={new Error(error)} />}
      {backup && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="text-[13px]">
            <b>{fileName}</b> · format v{backup.version} · exported {formatTimestamp(backup.exported_at, true)} · scope {backup.scope}
          </div>
          <table className="w-full max-w-md text-xs">
            <thead className="text-left text-fg-3"><tr><th className="font-medium">Data</th><th className="font-medium">In backup</th><th className="font-medium">Currently</th></tr></thead>
            <tbody>
              {[['media', 'Titles'], ['library_entries', 'Library entries'], ['tracking_sessions', 'Sessions'], ['activity_log', 'Activity events']].map(([k, label]) => (
                <tr key={k}><td>{label}</td><td className="tabular-nums">{backup.tables[k as keyof Backup['tables']]?.length ?? 0}</td><td className="tabular-nums">{counts.data?.[k] ?? '…'}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <label className="flex items-start gap-2 text-[13px]"><input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} className="mt-1 accent-[var(--accent)]" /> <span><b>Merge</b> — add titles and history that are not in the library yet. Existing data is kept as is.</span></label>
            <label className="flex items-start gap-2 text-[13px]"><input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="mt-1 accent-[var(--accent)]" /> <span><b>Replace</b> — delete the current library, then restore this backup exactly.</span></label>
          </div>
          {mode === 'replace' && (
            <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-[13px]">
              <span className="flex items-center gap-1.5 font-medium text-danger"><TriangleAlert className="size-4" /> This deletes {counts.data?.media ?? '…'} titles currently in your library.</span>
              <Button size="sm" variant="secondary" className="self-start" onClick={() => void safetyBackup()}><Download /> Download a backup of the current library first</Button>
            </div>
          )}
          {progress && (
            <div className="flex flex-col gap-1" aria-live="polite">
              <ProgressBar ratio={progress.total ? progress.done / progress.total : null} />
              <span className="text-xs text-fg-3">{progress.msg}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} disabled={!!progress} onClick={() => (mode === 'replace' ? setConfirmOpen(true) : void run())}>
              {mode === 'replace' ? 'Replace library…' : 'Merge into library'}
            </Button>
            <Button variant="ghost" onClick={() => setBackup(null)} disabled={!!progress}>Cancel</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmText('') }} destructive
        title="Replace your whole library?" confirmLabel="Replace" confirmDisabled={confirmText !== 'DELETE MY LIBRARY'}
        description={<>Type <b>DELETE MY LIBRARY</b> to confirm. Everything currently stored will be deleted and replaced by the backup.</>}
        onConfirm={() => run()}>
        <Input className="mt-3" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Confirmation text" autoComplete="off" />
      </ConfirmDialog>
    </div>
  )
}

function DeleteLibrary() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <>
      <p className="text-[13px] text-fg-2">Delete every title, rating, session, note and activity event. Settings are kept. Download a backup first.</p>
      <Button variant="danger" className="self-start" onClick={() => setOpen(true)}>Delete library…</Button>
      <ConfirmDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setText('') }} destructive title="Delete your entire library?"
        confirmLabel="Delete everything" confirmDisabled={text !== 'DELETE MY LIBRARY'}
        description={<>This cannot be undone. Type <b>DELETE MY LIBRARY</b> to confirm.</>}
        onConfirm={async () => {
          try {
            unwrap(await supabase.rpc('wipe_library', { p_confirm: text }), 'wipe')
            toast.success('Library deleted')
            invalidateLibrary(qc)
          } catch (e) {
            toast.error(friendlyError(e))
          }
        }}>
        <Input className="mt-3" value={text} onChange={(e) => setText(e.target.value)} aria-label="Confirmation text" autoComplete="off" />
      </ConfirmDialog>
    </>
  )
}
