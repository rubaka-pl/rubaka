import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox, Input } from '@/components/ui/form-controls'
import { EmptyState, ProgressBar } from '@/components/ui/misc'
import { Select } from '@/components/ui/select'
import { invalidateLibrary, type MediaDetail } from '@/features/tracking/api'
import type { VnRoute } from '@/types/db'
import { todayISO } from '@/lib/dates'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'

function useDb(mediaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (e) => toast.error(friendlyError(e)),
    onSettled: () => invalidateLibrary(qc, mediaId),
  })
}

/**
 * Per-season progress for TV / animated series. Season metadata comes from
 * TVMaze/TMDB or is added by hand; overall episode counters on the entry are
 * recalculated by a database trigger from these rows.
 */
export function SeasonsPanel({ d }: { d: MediaDetail }) {
  const e = d.entry
  const db = useDb(d.media.id)
  const [newSeason, setNewSeason] = useState('')
  const [newCount, setNewCount] = useState('')
  if (!e) return null
  const progress = new Map(d.seasonProgress.map((p) => [p.season_number, p.episodes_watched]))
  const seasons = d.seasons.length ? d.seasons : d.seasonProgress.map((p) => ({ media_id: d.media.id, season_number: p.season_number, title: null, episode_count: null, air_date: null }))

  const setSeason = (season: number, watched: number) => db.mutate(async () => unwrap(
    await supabase.from('entry_season_progress').upsert({ entry_id: e.id, season_number: season, episodes_watched: Math.max(0, watched) }), 'season progress'))

  const addSeason = () => {
    const n = Number(newSeason)
    if (!Number.isInteger(n) || n < 0) return
    db.mutate(async () => unwrap(await supabase.from('media_seasons').upsert({
      media_id: d.media.id, season_number: n, episode_count: newCount ? Math.max(1, Number(newCount)) : null,
    }), 'add season'))
    setNewSeason(''); setNewCount('')
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      {seasons.length === 0 && (
        <EmptyState className="py-6" title="No season information" description="Fill missing metadata (TVMaze/TMDB) or add seasons manually below. Without seasons, track overall episodes in the panel above." />
      )}
      <ul className="flex flex-col gap-1.5">
        {seasons.filter((s) => s.season_number > 0 || progress.has(0)).map((s) => {
          const watched = progress.get(s.season_number) ?? 0
          const total = s.episode_count
          return (
            <li key={s.season_number} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
              <div className="w-36 min-w-0">
                <div className="text-[13px] font-medium">Season {s.season_number}</div>
                {s.title && s.title !== `Season ${s.season_number}` && <div className="truncate text-[11px] text-fg-3">{s.title}</div>}
              </div>
              <ProgressBar ratio={total ? watched / total : null} className="flex-1" label={`Season ${s.season_number} progress`} />
              <div className="flex items-center gap-1">
                <Button size="icon-sm" variant="outline" aria-label={`Season ${s.season_number}: one less`} disabled={watched <= 0} onClick={() => setSeason(s.season_number, watched - 1)}><Minus /></Button>
                <span className="w-16 text-center text-[13px] tabular-nums">{watched} / {total ?? '?'}</span>
                <Button size="icon-sm" variant="outline" aria-label={`Season ${s.season_number}: one more`} disabled={total != null && watched >= total} onClick={() => setSeason(s.season_number, watched + 1)}><Plus /></Button>
                {total != null && watched < total && <Button size="sm" variant="ghost" onClick={() => setSeason(s.season_number, total)}>All</Button>}
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
        <label className="flex flex-col gap-1 text-xs text-fg-2">Season #<Input type="number" min={0} className="w-20" value={newSeason} onChange={(ev) => setNewSeason(ev.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-fg-2">Episodes (optional)<Input type="number" min={1} className="w-28" value={newCount} onChange={(ev) => setNewCount(ev.target.value)} /></label>
        <Button size="sm" onClick={addSeason} disabled={newSeason === ''}><Plus /> Add season</Button>
      </div>
    </div>
  )
}


function RouteGroup({ title, items, total, db }: { title: string; items: VnRoute[]; total?: number | null; db: ReturnType<typeof useDb> }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold">{title} <span className="font-normal text-fg-3">{items.filter((r) => r.completed).length} / {total ?? items.length}</span></h3>
      {items.length === 0 ? <p className="text-[13px] text-fg-3">None added.</p> : (
        <ul className="flex flex-col gap-1">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-1.5">
              <Checkbox checked={r.completed} aria-label={`${r.name} completed`}
                onCheckedChange={(v) => db.mutate(async () => unwrap(await supabase.from('vn_routes').update({ completed: v === true, completed_on: v === true ? todayISO() : null }).eq('id', r.id), 'route'))} />
              <span className={r.completed ? 'text-fg-2 line-through decoration-fg-3' : ''}>{r.name}</span>
              {r.completed_on && <span className="text-[11px] text-fg-3">{r.completed_on}</span>}
              <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Delete ${r.name}`}
                onClick={() => db.mutate(async () => unwrap(await supabase.from('vn_routes').delete().eq('id', r.id), 'delete route'))}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Manual route / ending checklist for visual novels. Routes are never invented. */
export function RoutesPanel({ d }: { d: MediaDetail }) {
  const e = d.entry
  const db = useDb(d.media.id)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'route' | 'ending'>('route')
  if (!e) return null
  const add = () => {
    if (!name.trim()) return
    db.mutate(async () => unwrap(await supabase.from('vn_routes').insert({ entry_id: e.id, name: name.trim(), kind, sort_order: d.routes.length }), 'add route'))
    setName('')
  }
  const routes = d.routes.filter((r) => r.kind === 'route')
  const endings = d.routes.filter((r) => r.kind === 'ending')
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <RouteGroup title="Routes" items={routes} total={d.media.total_routes} db={db} />
      <RouteGroup title="Endings" items={endings} db={db} />
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line p-3">
        <Input value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Route or ending name" className="min-w-48 flex-1" aria-label="Route name" onKeyDown={(ev) => ev.key === 'Enter' && add()} />
        <Select value={kind} onValueChange={(v) => setKind(v as 'route' | 'ending')} options={[{ value: 'route', label: 'Route' }, { value: 'ending', label: 'Ending' }]} className="w-28" aria-label="Kind" />
        <Button size="md" onClick={add} disabled={!name.trim()}><Plus /> Add</Button>
      </div>
      <p className="text-[11px] text-fg-3">Checking items updates “Routes completed” and “Endings completed” automatically.</p>
    </div>
  )
}
