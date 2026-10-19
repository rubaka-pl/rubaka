/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { Check, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/form-controls'
import { Badge, EmptyState } from '@/components/ui/misc'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { useSessionMutations, useUpdateEntry, type MediaDetail } from '@/features/tracking/api'
import { CATEGORY_CONFIG, statusLabel } from '@/lib/categories'
import { formatDate, todayISO } from '@/lib/dates'
import type { SessionStatus, TrackingSession } from '@/types/db'

/**
 * History = the initial run (from the entry's own dates/rating) + repeat
 * sessions. Imported repeats without dates are shown as a single editable
 * "undated" count rather than invented sessions. A repeat never changes the
 * entry's Completed status; incomplete or abandoned sessions are not counted.
 */
export function HistoryTab({ d }: { d: MediaDetail }) {
  const e = d.entry
  const m = d.media
  const cfg = CATEGORY_CONFIG[m.category]
  const sessions = useSessionMutations(m.id)
  const update = useUpdateEntry()
  const [editing, setEditing] = useState<TrackingSession | 'new' | null>(null)
  const [deleting, setDeleting] = useState<TrackingSession | null>(null)
  if (!e) return null
  const active = d.sessions.find((s) => s.status === 'active')
  const unit = cfg.progress === 'episodes' ? 'Episodes' : cfg.progress === 'chapters' ? 'Chapters' : cfg.progress === 'routes' ? 'Routes' : null
  const total = cfg.progress === 'episodes' ? m.total_episodes : cfg.progress === 'chapters' ? m.total_chapters : cfg.progress === 'routes' ? m.total_routes : null

  const start = () => sessions.create.mutate({ entry_id: e.id, session_type: cfg.sessionType, status: 'active', start_date: todayISO(), progress: 0 })
  const finish = (s: TrackingSession, status: SessionStatus) =>
    sessions.update.mutate({ id: s.id, patch: { status, end_date: s.end_date ?? todayISO(), ...(status === 'completed' && total ? { progress: total } : {}) } })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{cfg.repeatLabel} history</h2>
        <div className="flex gap-2">
          {!active && (
            <Button variant="primary" size="sm" onClick={start} loading={sessions.create.isPending} disabled={e.status !== 'completed'}
              title={e.status !== 'completed' ? `Complete the title first to start a ${cfg.repeatLabel.toLowerCase()}` : undefined}>
              <Play /> Start {cfg.repeatLabel.toLowerCase()}
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing('new')}><Plus /> Log past {cfg.repeatLabel.toLowerCase()}</Button>
        </div>
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <Badge tone="accent">{cfg.repeatLabel} in progress</Badge>
          <span className="text-[13px] text-fg-2">Started {formatDate(active.start_date)}</span>
          {unit && (
            <label className="flex items-center gap-1.5 text-[13px]">
              {unit}
              <Input type="number" min={0} max={total ?? undefined} className="w-20" value={active.progress ?? 0}
                onChange={(ev) => sessions.update.mutate({ id: active.id, patch: { progress: Math.max(0, Math.min(total ?? Infinity, Number(ev.target.value) || 0)) } })} />
              <span className="text-fg-3">/ {total ?? '?'}</span>
            </label>
          )}
          <div className="ml-auto flex gap-1.5">
            <Button size="sm" variant="primary" onClick={() => finish(active, 'completed')}><Check /> Complete</Button>
            <Button size="sm" variant="ghost" onClick={() => finish(active, 'abandoned')}><X /> Abandon</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="bg-surface text-left text-xs text-fg-3">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Start</th>
              <th className="px-3 py-2 font-medium">End</th>
              <th className="px-3 py-2 font-medium">Rating</th>
              <th className="px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="px-3 py-2 text-fg-3">1</td>
              <td className="px-3 py-2">Initial</td>
              <td className="px-3 py-2">{formatDate(e.start_date)}</td>
              <td className="px-3 py-2">{formatDate(e.completion_date)}</td>
              <td className="px-3 py-2"><StarRating value={e.rating} size="sm" /></td>
              <td className="px-3 py-2 tabular-nums">{unit ? `${cfg.progress === 'episodes' ? e.episodes_watched : cfg.progress === 'chapters' ? e.chapters_read : e.routes_completed} / ${total ?? '?'}` : '—'}</td>
              <td className="px-3 py-2">{statusLabel(e.status, m.category)}</td>
              <td />
            </tr>
            {d.sessions.map((s, i) => (
              <tr key={s.id}>
                <td className="px-3 py-2 text-fg-3">{i + 2}</td>
                <td className="px-3 py-2">{cfg.repeatLabel} #{i + 1}{s.season_number != null ? ` · S${s.season_number}` : ''}</td>
                <td className="px-3 py-2">{formatDate(s.start_date)}</td>
                <td className="px-3 py-2">{formatDate(s.end_date)}</td>
                <td className="px-3 py-2">{s.rating != null ? <StarRating value={s.rating} size="sm" /> : <span className="text-fg-3">—</span>}</td>
                <td className="px-3 py-2 tabular-nums">{unit && s.progress != null ? `${s.progress} / ${total ?? '?'}` : '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={s.status === 'completed' ? 'success' : s.status === 'active' ? 'accent' : 'default'}>{s.status === 'active' ? 'In progress' : s.status === 'completed' ? 'Completed' : 'Abandoned'}</Badge>
                </td>
                <td className="px-2 py-1 text-right">
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(s)} aria-label="Edit session"><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(s)} aria-label="Delete session"><Trash2 /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
        <span className="text-fg-2">Undated {cfg.repeatLabel.toLowerCase()}s (e.g. from imports):</span>
        <Input type="number" min={0} className="w-20" value={e.imported_repeat_count} aria-label="Undated repeat count"
          onChange={(ev) => update.mutate({ entryId: e.id, mediaId: m.id, patch: { imported_repeat_count: Math.max(0, Math.trunc(Number(ev.target.value) || 0)) } })} />
        <span className="text-fg-3">Total {cfg.repeatLabel.toLowerCase()}s: {e.repeat_count} = {e.imported_repeat_count} undated + {e.session_repeat_count} logged</span>
      </div>
      {d.sessions.length === 0 && e.imported_repeat_count === 0 && (
        <EmptyState title={`No ${cfg.repeatLabel.toLowerCase()}s yet`} description={`Start a ${cfg.repeatLabel.toLowerCase()} after completing, or log a past one with its dates.`} className="py-6" />
      )}

      {editing && <SessionDialog d={d} session={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} destructive title="Delete this session?"
        description="The session and its notes are removed. Other history is unaffected." confirmLabel="Delete"
        onConfirm={async () => { if (deleting) await sessions.remove.mutateAsync(deleting.id) }} />
    </div>
  )
}

function SessionDialog({ d, session, onClose }: { d: MediaDetail; session: TrackingSession | null; onClose: () => void }) {
  const cfg = CATEGORY_CONFIG[d.media.category]
  const { create, update } = useSessionMutations(d.media.id)
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? 'completed')
  const [start, setStart] = useState(session?.start_date ?? '')
  const [end, setEnd] = useState(session?.end_date ?? '')
  const [rating, setRating] = useState<number | null>(session?.rating ?? null)
  const [progress, setProgress] = useState<string>(session?.progress != null ? String(session.progress) : '')
  const [season, setSeason] = useState<string>(session?.season_number != null ? String(session.season_number) : '')
  const [notes, setNotes] = useState(session?.notes ?? '')
  const hasActive = d.sessions.some((s) => s.status === 'active' && s.id !== session?.id)
  const error = start && end && end < start ? 'End date is before start date' : status === 'active' && hasActive ? `Another ${cfg.repeatLabel.toLowerCase()} is already in progress` : null

  const save = async () => {
    const patch = {
      status, start_date: start || null, end_date: end || null, rating,
      progress: progress === '' ? null : Math.max(0, Number(progress)),
      season_number: season === '' ? null : Math.max(0, Number(season)),
      notes: notes.trim() || null,
    }
    if (session) await update.mutateAsync({ id: session.id, patch })
    else await create.mutateAsync({ entry_id: d.entry!.id, session_type: cfg.sessionType, ...patch })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={session ? `Edit ${cfg.repeatLabel.toLowerCase()}` : `Log a ${cfg.repeatLabel.toLowerCase()}`} description="Dates are optional. Only completed sessions count toward the total.">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" htmlFor="sd-status">
              <Select id="sd-status" value={status} onValueChange={(v) => setStatus(v as SessionStatus)} options={[{ value: 'completed', label: 'Completed' }, { value: 'active', label: 'In progress' }, { value: 'abandoned', label: 'Abandoned' }]} />
            </Field>
            <Field label="Rating for this session"><StarRating value={rating} onChange={setRating} showControls /></Field>
            <Field label="Start date" htmlFor="sd-start"><Input id="sd-start" type="date" value={start} onChange={(ev) => setStart(ev.target.value)} /></Field>
            <Field label="End date" htmlFor="sd-end"><Input id="sd-end" type="date" value={end} onChange={(ev) => setEnd(ev.target.value)} /></Field>
            {cfg.progress !== 'none' && cfg.progress !== 'single' && (
              <Field label="Progress" htmlFor="sd-prog"><Input id="sd-prog" type="number" min={0} value={progress} onChange={(ev) => setProgress(ev.target.value)} /></Field>
            )}
            {cfg.seasons && <Field label="Season only (optional)" htmlFor="sd-season"><Input id="sd-season" type="number" min={0} value={season} onChange={(ev) => setSeason(ev.target.value)} /></Field>}
          </div>
          <Field label="Notes" htmlFor="sd-notes"><Textarea id="sd-notes" rows={3} value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
          <p className="text-xs text-fg-3">The session rating does not change your overall rating.</p>
          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!!error} loading={create.isPending || update.isPending}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
