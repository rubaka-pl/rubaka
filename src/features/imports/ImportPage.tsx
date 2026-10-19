/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Download, FileUp, LoaderCircle, Play, Square, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/form-controls'
import { Badge, EmptyState, ErrorState, PillTabs, ProgressBar, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { invalidateLibrary } from '@/features/tracking/api'
import { CATEGORY_CONFIG, CATEGORY_LIST, statusLabel } from '@/lib/categories'
import { formatTimestamp } from '@/lib/dates'
import { starsText } from '@/lib/rating'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { downloadFile } from '@/lib/utils'
import type { ImportJob, ImportRecordRow, MediaCategory } from '@/types/db'
import { EnrichmentPanel } from '@/features/enrichment/EnrichmentPanel'
import {
  applyPolicy, buildPlan, createJob, detectAdapter, finishJob, hashText, invalidToPlan, matchRecords, readImportFile,
  runImport, summarize, ADAPTERS, type ApplyOutcome, type ConflictPolicy, type PlanItem, type PlanKind,
} from './pipeline'
import type { ImportAdapter, ParseResult } from './types'
import { fetchVndbList, resolveVndbUser, vndbAdapter } from './adapters/vndb'
import { Input } from '@/components/ui/form-controls'

type Stage = 'select' | 'analyzing' | 'preview' | 'importing' | 'done'

const RESUME_KEY = 'rubaka.import.resume'

export function ImportPage() {
  const [tab, setTab] = useState('import')
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold tracking-tight">Import</h1>
      <p className="mt-0.5 text-[13px] text-fg-3">Bring in MyAnimeList, IMDb and Backloggd exports, then fill in missing metadata.</p>
      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="import">Import file</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="import" className="pt-4"><ImportWizard onGoToMetadata={() => setTab('metadata')} /></TabsContent>
        <TabsContent value="metadata" className="pt-4"><EnrichmentPanel /></TabsContent>
        <TabsContent value="history" className="pt-4"><ImportHistory /></TabsContent>
      </Tabs>
    </PageContainer>
  )
}

function ImportWizard({ onGoToMetadata }: { onGoToMetadata: () => void }) {
  const qc = useQueryClient()
  const [stage, setStage] = useState<Stage>('select')
  const [error, setError] = useState<unknown>(null)
  const [fileName, setFileName] = useState('')
  const [text, setText] = useState('')
  const [fileHash, setFileHash] = useState('')
  const [adapter, setAdapter] = useState<ImportAdapter | null>(null)
  const [options, setOptions] = useState<Record<string, string>>({})
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [plan, setPlan] = useState<PlanItem[]>([])
  const [policy, setPolicy] = useState<ConflictPolicy>('merge')
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' })
  const [outcomes, setOutcomes] = useState<ApplyOutcome[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const cancelled = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const analyze = async (src: string, name: string, a: ImportAdapter, opts: Record<string, string>) => {
    setStage('analyzing'); setError(null)
    try {
      const res = a.parse(src, opts)
      setParsed(res)
      setProgress({ done: 0, total: res.records.length, label: 'Checking your library for existing titles…' })
      const matches = await matchRecords(res.records, (done) => setProgress((p) => ({ ...p, done })))
      setPlan([...buildPlan(res, matches, policy), ...invalidToPlan(res.invalid)])
      setStage('preview')
    } catch (e) {
      setError(e); setStage('select')
    }
    void name
  }

  const onFile = async (file: File) => {
    setError(null)
    try {
      const src = await readImportFile(file)
      const a = detectAdapter(file.name, src)
      if (!a) throw new Error('Unrecognized file. Supported: MyAnimeList XML (.xml / .xml.gz), IMDb CSV, Backloggd JSON (Toolkittd).')
      const opts = Object.fromEntries(a.options.map((o) => [o.key, o.default]))
      setFileName(file.name); setText(src); setAdapter(a); setOptions(opts); setFileHash(await hashText(src))
      await analyze(src, file.name, a, opts)
    } catch (e) {
      setError(e)
    }
  }

  /** VNDB: read the user's list from the API, then continue exactly like a file import. */
  const onVndb = async (name: string, token: string) => {
    setError(null)
    setStage('analyzing')
    setProgress({ done: 0, total: 0, label: 'Finding VNDB user…' })
    try {
      const user = await resolveVndbUser(name)
      if (!user) throw new Error(`VNDB user “${name}” was not found. Use the username or the id from your profile URL (e.g. u12345).`)
      const items = await fetchVndbList(user.id, token || undefined, (n) => setProgress({ done: n, total: 0, label: `Reading ${user.username}'s list… ${n} titles` }))
      if (!items.length) throw new Error(`The VNDB list of ${user.username} is empty or private. For a private list, add an API token with “listread” permission.`)
      const src = JSON.stringify({ user: user.username, items })
      const opts = Object.fromEntries(vndbAdapter.options.map((o) => [o.key, o.default]))
      const label = `VNDB: ${user.username}`
      setFileName(label); setText(src); setAdapter(vndbAdapter); setOptions(opts); setFileHash(await hashText(`vndb:${user.id}:${items.length}`))
      await analyze(src, label, vndbAdapter, opts)
    } catch (e) {
      setError(e)
      setStage('select')
    }
  }

  const changeOption = (key: string, value: string) => {
    const next = { ...options, [key]: value }
    setOptions(next)
    if (adapter) void analyze(text, fileName, adapter, next)
  }

  const changePolicy = (p: ConflictPolicy) => {
    setPolicy(p)
    setPlan((items) => items.map((it) => applyPolicy(it, p)))
  }

  const start = async () => {
    if (!parsed || !adapter) return
    cancelled.current = false
    setStage('importing'); setOutcomes([])
    try {
      // Resume: same file + an unfinished job => reuse the job (processed rows are skipped server-side).
      let id: string | null = null
      try {
        const saved = JSON.parse(localStorage.getItem(RESUME_KEY) ?? 'null') as { hash: string; jobId: string } | null
        if (saved?.hash === fileHash) {
          const { data } = await supabase.from('import_jobs').select('id, status').eq('id', saved.jobId).maybeSingle()
          if (data?.status === 'running') id = data.id
        }
      } catch { /* no resume */ }
      if (!id) id = await createJob(parsed.source, fileName, { ...options, policy, fileHash })
      setJobId(id)
      try { localStorage.setItem(RESUME_KEY, JSON.stringify({ hash: fileHash, jobId: id })) } catch { /* ignore */ }
      const todo = plan
      setProgress({ done: 0, total: todo.length, label: 'Importing…' })
      const res = await runImport(id, todo, (done, outs) => { setProgress((p) => ({ ...p, done })); setOutcomes([...outs]) }, () => cancelled.current)
      await finishJob(id, cancelled.current ? 'cancelled' : undefined)
      if (!cancelled.current) { try { localStorage.removeItem(RESUME_KEY) } catch { /* ignore */ } }
      setOutcomes(res)
      setStage('done')
      invalidateLibrary(qc)
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
    } catch (e) {
      setError(e)
      toast.error(`Import stopped: ${friendlyError(e)}. Select the same file again to resume.`)
      setStage('preview')
    }
  }

  const reset = () => {
    setStage('select'); setParsed(null); setPlan([]); setOutcomes([]); setText(''); setAdapter(null); setJobId(null); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (stage === 'select') {
    return (
      <div className="flex flex-col gap-4">
        {error != null && <ErrorState error={error} />}
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-line bg-surface/50 px-6 py-14 text-center transition-colors hover:border-accent/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f) }}
        >
          <Upload className="size-8 text-accent" />
          <div className="text-[15px] font-semibold">Drop an export file or click to choose</div>
          <div className="max-w-lg text-[13px] text-fg-3">Nothing is written until you review the preview and confirm. Re-importing the same file never creates duplicates.</div>
          <input ref={inputRef} type="file" className="sr-only" accept=".xml,.gz,.csv,.json,application/gzip,text/csv,application/json,text/xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
        </label>
        <VndbForm onSubmit={(n, t) => void onVndb(n, t)} />
        <div className="grid gap-3 md:grid-cols-3">
          {ADAPTERS.filter((a) => a.source !== 'vndb_api').map((a) => (
            <div key={a.source} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
              <div className="font-semibold">{a.label}</div>
              <p className="mt-1 text-fg-3">
                {a.source === 'mal_xml' && 'MyAnimeList → Profile → Export my list. Anime and manga files (.xml.gz) work as downloaded.'}
                {a.source === 'imdb_csv' && 'IMDb → your list/watchlist/ratings → Export. The CSV contains ratings but no watch status or dates.'}
                {a.source === 'backloggd_json' && 'Install the Toolkittd extension, then Backloggd → Settings → Data Management → Export. Use the JSON file.'}
              </p>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (stage === 'analyzing') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
        <LoaderCircle className="size-6 animate-spin text-accent" />
        <div className="text-[13px] text-fg-2">{progress.label}</div>
        <ProgressBar ratio={progress.total ? progress.done / progress.total : null} className="max-w-sm" />
      </div>
    )
  }

  if (stage === 'importing') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" role="status" aria-live="polite">
        <LoaderCircle className="size-6 animate-spin text-accent" />
        <div className="text-[13px] text-fg-2">Importing {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…</div>
        <ProgressBar ratio={progress.total ? progress.done / progress.total : 0} className="max-w-sm" />
        <Button variant="ghost" onClick={() => { cancelled.current = true }}><Square /> Stop after this batch</Button>
      </div>
    )
  }

  if (stage === 'done') return <ImportReport outcomes={outcomes} plan={plan} jobId={jobId} fileName={fileName} onNew={reset} onGoToMetadata={onGoToMetadata} />

  return (
    <Preview
      fileName={fileName} adapter={adapter!} parsed={parsed!} plan={plan} setPlan={setPlan} options={options} onOption={changeOption}
      policy={policy} onPolicy={changePolicy} onStart={() => void start()} onCancel={reset} error={error}
    />
  )
}

function VndbForm({ onSubmit }: { onSubmit: (name: string, token: string) => void }) {
  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  return (
    <form className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), token) }}>
      <div>
        <div className="text-[13px] font-semibold">VNDB — import your visual novel list</div>
        <p className="mt-0.5 text-xs text-fg-3">Reads your list directly from vndb.org: statuses (labels), votes, start/finish dates, notes, plus covers and descriptions.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vndb-user">VNDB username or id</Label>
          <Input id="vndb-user" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. RubakaPL or u12345" className="w-56" autoComplete="off" />
        </div>
        {showToken && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vndb-token">API token (only for private lists)</Label>
            <Input id="vndb-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="xxxx-xxxxx-…" className="w-64" autoComplete="off" />
          </div>
        )}
        <Button type="submit" variant="primary" disabled={!name.trim()}>Load list</Button>
        {!showToken && <Button variant="link" size="sm" onClick={() => setShowToken(true)}>My list is private</Button>}
      </div>
      {showToken && (
        <p className="text-[11px] text-fg-3">
          vndb.org → your profile → Edit → Applications → New token, tick “Access to my list (including private items)”. The token is used for this request only and is not saved.
        </p>
      )}
    </form>
  )
}

// ---------------------------------------------------------------- Preview
const KIND_LABEL: Record<PlanKind, string> = {
  new: 'New', existing: 'Already in library', duplicate: 'Possible duplicates', review: 'Needs review', skip: 'Skipped by default', invalid: 'Invalid',
}

function Preview({ fileName, adapter, parsed, plan, setPlan, options, onOption, policy, onPolicy, onStart, onCancel, error }: {
  fileName: string; adapter: ImportAdapter; parsed: ParseResult; plan: PlanItem[]; setPlan: (fn: (p: PlanItem[]) => PlanItem[]) => void
  options: Record<string, string>; onOption: (k: string, v: string) => void; policy: ConflictPolicy; onPolicy: (p: ConflictPolicy) => void
  onStart: () => void; onCancel: () => void; error: unknown
}) {
  const s = useMemo(() => summarize(plan), [plan])
  const [view, setView] = useState<PlanKind>(s.byKind.review ? 'review' : s.byKind.duplicate ? 'duplicate' : s.byKind.existing ? 'existing' : 'new')
  const writes = plan.filter((p) => p.decision === 'create' || p.decision === 'merge').length
  const meta = parsed.meta as { declaredTotal?: number; parsed?: number; user?: string; ratingScale?: string }

  const update = (key: string, patch: Partial<PlanItem>) => setPlan((items) => items.map((it) => (it.record.source_key === key && it.kind !== 'invalid' ? { ...it, ...patch } : it)))
  const setCategory = (key: string, category: MediaCategory) => setPlan((items) => items.map((it) => {
    if (it.record.source_key !== key) return it
    const formats = CATEGORY_CONFIG[category].formats.map((f) => f.value)
    const format = it.record.media.format && formats.includes(it.record.media.format) ? it.record.media.format : category === 'anime' ? 'tv' : null
    return { ...it, record: { ...it.record, media: { ...it.record.media, category, format } } }
  }))

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold"><FileUp className="size-4 text-accent" /> {fileName}</div>
          <div className="mt-0.5 text-[13px] text-fg-3">
            Detected: {adapter.label}{meta.user ? ` · user ${meta.user}` : ''}{meta.ratingScale ? ` · rating scale ${meta.ratingScale === 'half' ? '1–10' : '0.5–5'}` : ''}
          </div>
          {meta.declaredTotal != null && meta.parsed != null && meta.declaredTotal !== meta.parsed && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warning"><CircleAlert className="size-3.5" /> The file header says {meta.declaredTotal} entries but contains {meta.parsed}. All {meta.parsed} are shown.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Choose another file</Button>
          <Button variant="primary" onClick={onStart} disabled={writes === 0}><Play /> Import {writes.toLocaleString()} {writes === 1 ? 'entry' : 'entries'}</Button>
        </div>
      </div>
      {error != null && <ErrorState error={error} />}

      {adapter.options.length > 0 && (
        <section className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-3">
          {adapter.options.map((o) => (
            <div key={o.key} className="flex flex-col gap-1.5">
              <Label htmlFor={`opt-${o.key}`}>{o.label}</Label>
              <Select id={`opt-${o.key}`} value={options[o.key]} onValueChange={(v) => onOption(o.key, v)} options={o.choices} />
              {o.description && <p className="text-[11px] text-fg-3">{o.description}</p>}
            </div>
          ))}
        </section>
      )}

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={s.total} />
        {(['new', 'existing', 'duplicate', 'review', 'invalid'] as PlanKind[]).map((k) => <Stat key={k} label={KIND_LABEL[k]} value={s.byKind[k]} tone={k === 'invalid' && s.byKind[k] ? 'danger' : k === 'review' || k === 'duplicate' ? 'warning' : undefined} />)}
      </section>
      <div className="flex flex-wrap gap-1.5 text-xs text-fg-2">
        By category: {Object.entries(s.byCategory).map(([c, n]) => <Badge key={c}>{CATEGORY_CONFIG[c as MediaCategory].label}: {n}</Badge>)}
        {s.byKind.skip > 0 && <Badge>Skipped by default: {s.byKind.skip}</Badge>}
      </div>

      {s.byKind.existing > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3">
          <Label htmlFor="policy">For titles already in your library</Label>
          <Select id="policy" value={policy} onValueChange={(v) => onPolicy(v as ConflictPolicy)} className="w-72" options={[
            { value: 'merge', label: 'Merge: fill empty fields, keep your values (safe)' },
            { value: 'keep', label: 'Keep existing: change nothing' },
            { value: 'imported', label: 'Use imported values for conflicts' },
            { value: 'skip', label: 'Skip these entries' },
          ]} />
          <span className="text-xs text-fg-3">{s.conflicts} with conflicting values. You can override per entry below.</span>
        </section>
      )}

      <PillTabs value={view} onChange={setView} items={(['new', 'existing', 'duplicate', 'review', 'skip', 'invalid'] as PlanKind[]).filter((k) => s.byKind[k] > 0).map((k) => ({ value: k, label: KIND_LABEL[k], count: s.byKind[k] }))} />
      <PlanTable items={plan.filter((p) => p.kind === view)} onUpdate={update} onCategory={setCategory} />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[11px] text-fg-3">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warning' && value ? 'text-warning' : ''}`}>{value.toLocaleString()}</div>
    </div>
  )
}

const PAGE = 100
const fmtField = (field: string, v: unknown) => {
  if (v == null || v === '') return '—'
  if (field === 'rating') return `${starsText(v as number)}★`
  if (field === 'status') return statusLabel(v as never)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).length > 40 ? `${String(v).slice(0, 40)}…` : String(v)
}

function PlanTable({ items, onUpdate, onCategory }: { items: PlanItem[]; onUpdate: (key: string, p: Partial<PlanItem>) => void; onCategory: (key: string, c: MediaCategory) => void }) {
  const [limit, setLimit] = useState(PAGE)
  if (!items.length) return <EmptyState title="Nothing here" className="py-8" />
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="bg-surface text-left text-xs text-fg-3">
            <tr><th className="px-3 py-2 font-medium">Title</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Your data</th><th className="px-3 py-2 font-medium">Details</th><th className="px-3 py-2 font-medium">Action</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.slice(0, limit).map((p) => {
              const r = p.record
              const key = r.source_key
              return (
                <tr key={key + p.kind} className="align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.media.title}</div>
                    <div className="text-[11px] text-fg-3">{key}{r.media.release_year ? ` · ${r.media.release_year}` : ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    {p.kind === 'invalid' ? '—' : (
                      <Select size="sm" aria-label="Category" value={r.media.category} onValueChange={(v) => onCategory(key, v as MediaCategory)} options={CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))} className="w-36" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-2">
                    {p.kind !== 'invalid' && <>
                      {r.entry.status && statusLabel(r.entry.status, r.media.category)}
                      {r.entry.rating != null && <> · {starsText(r.entry.rating)}★</>}
                      {r.entry.wishlisted_at && <> · Wishlist</>}
                      {(r.entry.imported_repeat_count ?? 0) > 0 && <> · {r.entry.imported_repeat_count}× repeat</>}
                      {r.sessions?.length ? <> · {r.sessions.length} session(s)</> : null}
                    </>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.reason && <div className="text-warning">{p.reason}</div>}
                    {r.warnings.map((w) => <div key={w} className="text-fg-3">{w}</div>)}
                    {p.kind === 'duplicate' && p.match?.candidates.map((c) => <div key={c.media_id} className="text-fg-3">Existing: {c.title}{c.release_year ? ` (${c.release_year})` : ''}</div>)}
                    {p.diffs.length > 0 && (
                      <ul className="flex flex-col gap-0.5">
                        {p.diffs.map((d) => (
                          <li key={d.field} className="flex items-center gap-1.5">
                            {d.type === 'conflict' ? (
                              <label className="flex items-center gap-1.5">
                                <input type="checkbox" className="accent-[var(--accent)]" checked={p.applyFields.includes(d.field)}
                                  onChange={(e) => onUpdate(key, { decision: 'merge', applyFields: e.target.checked ? [...p.applyFields, d.field] : p.applyFields.filter((f) => f !== d.field) })} />
                                <span className="text-fg-2">{d.field}:</span> <span className="text-fg-3">{fmtField(d.field, d.current)}</span> → <span className="text-warning">{fmtField(d.field, d.imported)}</span>
                              </label>
                            ) : (
                              <span className="text-fg-3">{d.field}: fill with {fmtField(d.field, d.imported)}{p.decision !== 'merge' ? ' (not applied)' : ''}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.kind === 'invalid' ? <Badge tone="danger">Recorded, not imported</Badge> : (
                      <Select size="sm" aria-label="Action" className="w-44"
                        value={p.decision === 'skip' ? 'skip' : p.targetMediaId ? `into:${p.targetMediaId}` : p.kind === 'existing' ? (p.decision === 'merge' ? (p.applyFields.length ? 'imported' : 'merge') : 'keep') : 'create'}
                        onValueChange={(v) => {
                          if (v === 'skip') onUpdate(key, { decision: 'skip', targetMediaId: undefined })
                          else if (v === 'create') onUpdate(key, { decision: 'create', targetMediaId: undefined })
                          else if (v === 'keep') onUpdate(key, { decision: 'create', applyFields: [] })
                          else if (v === 'merge') onUpdate(key, { decision: 'merge', applyFields: [] })
                          else if (v === 'imported') onUpdate(key, { decision: 'merge', applyFields: p.diffs.filter((d) => d.type === 'conflict').map((d) => d.field) })
                          else if (v.startsWith('into:')) onUpdate(key, { decision: 'merge', targetMediaId: v.slice(5), applyFields: [] })
                        }}
                        options={p.kind === 'existing' ? [
                          { value: 'merge', label: 'Merge (fill empty)' }, { value: 'keep', label: 'Keep existing' },
                          { value: 'imported', label: 'Use imported' }, { value: 'skip', label: 'Skip' },
                        ] : [
                          { value: 'create', label: 'Import as new' },
                          ...(p.match?.candidates ?? []).map((c) => ({ value: `into:${c.media_id}`, label: `Merge into “${c.title.slice(0, 24)}”` })),
                          { value: 'skip', label: 'Skip' },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {items.length > limit && <Button className="self-center" onClick={() => setLimit(limit + PAGE * 5)}>Show more ({(items.length - limit).toLocaleString()} left)</Button>}
    </div>
  )
}

// ---------------------------------------------------------------- Report
function ImportReport({ outcomes, plan, jobId, fileName, onNew, onGoToMetadata }: {
  outcomes: ApplyOutcome[]; plan: PlanItem[]; jobId: string | null; fileName: string; onNew: () => void; onGoToMetadata: () => void
}) {
  const counts = outcomes.reduce<Record<string, number>>((m, o) => ({ ...m, [o.outcome]: (m[o.outcome] ?? 0) + 1 }), {})
  const failed = outcomes.filter((o) => o.outcome === 'failed')
  const titleOf = new Map(plan.map((p) => [p.record.source_key, p.record.media.title]))
  const download = () => downloadFile(JSON.stringify({ file: fileName, job_id: jobId, finished_at: new Date().toISOString(), counts, outcomes: outcomes.map((o) => ({ ...o, title: titleOf.get(o.source_key) })) }, null, 2), `rubaka-import-report-${new Date().toISOString().slice(0, 10)}.json`)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        {failed.length ? <CircleAlert className="text-warning" /> : <CircleCheck className="text-success" />}
        Import {failed.length ? 'finished with errors' : 'complete'}
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {['created', 'updated', 'unchanged', 'skip', 'invalid', 'failed', 'already_processed'].filter((k) => counts[k]).map((k) => (
          <Stat key={k} label={k.replace('_', ' ')} value={counts[k]} tone={k === 'failed' ? 'danger' : undefined} />
        ))}
      </div>
      {failed.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
          <div className="mb-1.5 text-[13px] font-semibold">Failed records ({failed.length})</div>
          <ul className="max-h-60 overflow-y-auto text-xs text-fg-2">
            {failed.map((f) => <li key={f.source_key}><b>{titleOf.get(f.source_key) ?? f.source_key}</b>: {f.message}</li>)}
          </ul>
          <p className="mt-2 text-xs text-fg-3">Failed rows are stored with their original data in the import history. Fix them manually or re-import the file — successful rows will not be duplicated.</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={onGoToMetadata}>Fill missing metadata →</Button>
        <Button onClick={download}><Download /> Download report</Button>
        <Button variant="ghost" onClick={onNew}>Import another file</Button>
        <Button variant="ghost" asChild><Link to="/">Go to dashboard</Link></Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- History
function ImportHistory() {
  const jobs = useQuery({
    queryKey: ['import-jobs'],
    queryFn: async () => unwrap(await supabase.from('import_jobs').select('*').neq('source', 'rubaka_backup').order('created_at', { ascending: false }).limit(50), 'jobs') as ImportJob[],
  })
  const [open, setOpen] = useState<string | null>(null)
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
  if (jobs.isLoading) return <LoaderCircle className="size-5 animate-spin" />
  if (!jobs.data?.length) return <EmptyState title="No imports yet" className="py-8" />
  return (
    <ul className="flex flex-col gap-2">
      {jobs.data.map((j) => {
        const o = (j.summary as { outcomes?: Record<string, number> }).outcomes ?? {}
        return (
          <li key={j.id} className="rounded-lg border border-line bg-surface p-3">
            <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === j.id ? null : j.id)} aria-expanded={open === j.id}>
              <span className="font-medium">{j.file_name ?? j.source}</span>
              <Badge tone={j.status === 'completed' ? 'success' : j.status === 'partial' ? 'warning' : j.status === 'running' ? 'accent' : 'default'}>{j.status}</Badge>
              <span className="text-xs text-fg-3">{formatTimestamp(j.created_at, true)}</span>
              <span className="ml-auto text-xs text-fg-2">{Object.entries(o).map(([k, n]) => `${k} ${n}`).join(' · ')}</span>
            </button>
            {open === j.id && <JobRecords jobId={j.id} />}
          </li>
        )
      })}
    </ul>
  )
}

function JobRecords({ jobId }: { jobId: string }) {
  const [outcome, setOutcome] = useState('failed')
  const recs = useQuery({
    queryKey: ['import-records', jobId, outcome],
    queryFn: async () => unwrap(await supabase.from('import_records').select('id, source_key, row_number, outcome, message, media_id').eq('job_id', jobId).eq('outcome', outcome).order('row_number').limit(500), 'records') as ImportRecordRow[],
  })
  const exportAll = async () => {
    const all = unwrap(await supabase.from('import_records').select('source_key, row_number, outcome, message, raw').eq('job_id', jobId).order('row_number').limit(10000), 'records')
    downloadFile(JSON.stringify(all, null, 2), `rubaka-import-${jobId.slice(0, 8)}.json`)
  }
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select size="sm" value={outcome} onValueChange={setOutcome} className="w-36" aria-label="Outcome" options={['failed', 'invalid', 'skipped', 'created', 'updated', 'unchanged'].map((v) => ({ value: v, label: v }))} />
        <Button size="sm" variant="ghost" onClick={() => void exportAll()}><Download /> Export all records</Button>
      </div>
      {recs.isLoading ? <LoaderCircle className="size-4 animate-spin" /> : !recs.data?.length ? <p className="text-xs text-fg-3">No {outcome} records.</p> : (
        <ul className="max-h-72 overflow-y-auto text-xs">
          {recs.data.map((r) => (
            <li key={r.id} className="flex gap-2 py-0.5">
              <span className="w-12 shrink-0 text-fg-3">#{r.row_number}</span>
              {r.media_id ? <Link to={`/media/${r.media_id}`} className="text-accent-hover hover:underline">{r.source_key}</Link> : <span>{r.source_key}</span>}
              <span className="text-fg-3">{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
