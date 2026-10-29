/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PosterImage } from '@/components/media/PosterImage'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/form-controls'
import { Dialog, DialogContent } from '@/components/ui/overlays'
import { Select } from '@/components/ui/select'
import { invalidateLibrary, setMediaGenres, useUpdateMedia, type MediaDetail } from '@/features/tracking/api'
import { guessTitleKind, removeImage, uploadImage } from '@/lib/assets'
import { CATEGORY_CONFIG, CATEGORY_LIST, COUNTRY_LABEL, RELEASE_STATUS_LABEL } from '@/lib/categories'
import { assetUrl, friendlyError, supabase, unwrap } from '@/lib/supabase'
import type { Media, MediaCategory, MediaTitle, TitleKind } from '@/types/db'

const CREDIT_KEYS: Record<MediaCategory, string[]> = {
  anime: ['studios'], manga: ['authors', 'artists'], novel: ['authors', 'publishers'], visual_novel: ['developers', 'publishers', 'platforms'],
  movie: ['directors', 'cast'], tv_series: ['creators', 'networks', 'cast'], animated_series: ['creators', 'networks', 'cast'], game: ['developers', 'publishers', 'platforms'],
  doujinshi: ['artists', 'groups', 'parodies', 'characters'],
}
const KINDS: TitleKind[] = ['english', 'romaji', 'japanese', 'native', 'russian', 'synonym', 'other']
const num = (s: string) => (s.trim() === '' ? null : Math.trunc(Number(s)))

export function EditMediaDialog({ d, open, onOpenChange }: { d: MediaDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const m = d.media
  const qc = useQueryClient()
  const updateMedia = useUpdateMedia()
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    category: m.category, title: m.title, original_title: m.original_title ?? '', synopsis: m.synopsis ?? '', format: m.format ?? 'none',
    release_year: m.release_year?.toString() ?? '', release_date: m.release_date ?? '', end_date: m.end_date ?? '',
    release_status: m.release_status ?? 'none', country: m.country ?? '', poster_url: m.poster_url ?? '', backdrop_url: m.backdrop_url ?? '',
    total_episodes: m.total_episodes?.toString() ?? '', total_chapters: m.total_chapters?.toString() ?? '', total_volumes: m.total_volumes?.toString() ?? '',
    total_seasons: m.total_seasons?.toString() ?? '', total_routes: m.total_routes?.toString() ?? '',
    genres: d.genres.join(', '),
  })
  const [credits, setCredits] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.values(CREDIT_KEYS).flat().map((k) => [k, Array.isArray(m.details?.[k]) ? (m.details[k] as string[]).join(', ') : ''])))
  const [titles, setTitles] = useState<Pick<MediaTitle, 'title' | 'kind'>[]>(d.titles.map(({ title, kind }) => ({ title, kind })))
  const [newTitle, setNewTitle] = useState('')
  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [backdropFile, setBackdropFile] = useState<File | null>(null)
  const [removeCustomPoster, setRemoveCustomPoster] = useState(false)
  const [removeCustomBackdrop, setRemoveCustomBackdrop] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }))
  const cfg = CATEGORY_CONFIG[f.category]
  const formatValid = f.format === 'none' || cfg.formats.some((o) => o.value === f.format)
  const errors: string[] = []
  if (!f.title.trim()) errors.push('Title is required')
  if (f.release_date && f.end_date && f.end_date < f.release_date) errors.push('End date is before release date')
  for (const k of ['total_episodes', 'total_chapters', 'total_volumes', 'total_seasons', 'total_routes'] as const) {
    if (f[k] && !(Number(f[k]) > 0)) errors.push('Totals must be positive (leave empty if unknown)')
  }
  if (f.country && !/^[A-Za-z]{2}$/.test(f.country)) errors.push('Country must be a 2-letter code (e.g. JP)')

  const save = async () => {
    setBusy(true)
    try {
      const next: Partial<Media> = {
        category: f.category, title: f.title.trim(), original_title: f.original_title.trim() || null, synopsis: f.synopsis.trim() || null,
        format: formatValid && f.format !== 'none' ? f.format : null, release_year: num(f.release_year), release_date: f.release_date || null,
        end_date: f.end_date || null, release_status: f.release_status === 'none' ? null : (f.release_status as Media['release_status']),
        country: f.country ? f.country.toUpperCase() : null, poster_url: f.poster_url.trim() || null, backdrop_url: f.backdrop_url.trim() || null,
        total_episodes: num(f.total_episodes), total_chapters: num(f.total_chapters), total_volumes: num(f.total_volumes),
        total_seasons: num(f.total_seasons), total_routes: num(f.total_routes),
      }
      // Only send (and lock) what actually changed.
      const patch: Partial<Media> = {}
      for (const [k, v] of Object.entries(next)) if ((m as unknown as Record<string, unknown>)[k] !== v) (patch as Record<string, unknown>)[k] = v
      const details = { ...m.details }
      let detailsChanged = false
      for (const k of CREDIT_KEYS[f.category]) {
        const list = credits[k].split(',').map((s) => s.trim()).filter(Boolean)
        const cur = Array.isArray(m.details?.[k]) ? (m.details[k] as string[]) : []
        if (list.join('|') !== cur.join('|')) { detailsChanged = true; if (list.length) details[k] = list; else delete details[k] }
      }
      if (detailsChanged) patch.details = details
      if (posterFile) { patch.custom_poster_path = await uploadImage(posterFile, 'poster') }
      else if (removeCustomPoster) patch.custom_poster_path = null
      if (backdropFile) { patch.custom_backdrop_path = await uploadImage(backdropFile, 'backdrop') }
      else if (removeCustomBackdrop) patch.custom_backdrop_path = null

      if (Object.keys(patch).length) await updateMedia.mutateAsync({ mediaId: m.id, patch })
      if ((posterFile || removeCustomPoster) && m.custom_poster_path) void removeImage(m.custom_poster_path)
      if ((backdropFile || removeCustomBackdrop) && m.custom_backdrop_path) void removeImage(m.custom_backdrop_path)

      // Alternative titles: replace the set if it changed.
      const before = d.titles.map((t) => `${t.kind}:${t.title}`).sort().join('\n')
      const after = titles.map((t) => `${t.kind}:${t.title}`).sort().join('\n')
      if (before !== after) {
        unwrap(await supabase.from('media_titles').delete().eq('media_id', m.id), 'titles')
        if (titles.length) unwrap(await supabase.from('media_titles').insert(titles.map((t) => ({ ...t, media_id: m.id }))), 'titles')
        await updateMedia.mutateAsync({ mediaId: m.id, patch: { locked_fields: Array.from(new Set([...m.locked_fields, ...Object.keys(patch), 'titles'])) }, lock: false })
      }
      const genres = f.genres.split(',').map((s) => s.trim()).filter(Boolean)
      if (genres.join('|') !== d.genres.join('|')) {
        await setMediaGenres(m.id, genres)
        await updateMedia.mutateAsync({ mediaId: m.id, patch: { locked_fields: Array.from(new Set([...m.locked_fields, ...Object.keys(patch), 'genres'])) }, lock: false })
      }
      invalidateLibrary(qc, m.id)
      toast.success('Saved')
      onOpenChange(false)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const posterPreview = posterFile ? URL.createObjectURL(posterFile) : removeCustomPoster ? (f.poster_url || null) : (assetUrl(m.custom_poster_path) ?? (f.poster_url || null))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit metadata" description="Fields you change here are protected from automatic metadata enrichment." wide>
        <div className="flex flex-col gap-4">
          <div className="flex gap-4">
            <div className="w-28 shrink-0">
              <PosterImage src={posterPreview} title={f.title} category={f.category} />
              <label className="mt-1.5 flex cursor-pointer items-center justify-center gap-1 rounded border border-dashed border-line py-1 text-[11px] text-fg-3 hover:text-fg">
                <ImagePlus className="size-3.5" /> Upload cover
                <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(ev) => { setPosterFile(ev.target.files?.[0] ?? null); setRemoveCustomPoster(false) }} />
              </label>
              {(m.custom_poster_path || posterFile) && !removeCustomPoster && (
                <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => { setPosterFile(null); setRemoveCustomPoster(true) }}><Trash2 /> Remove upload</Button>
              )}
            </div>
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <Field label="Title" htmlFor="em-title" className="sm:col-span-2"><Input id="em-title" value={f.title} onChange={(e) => set('title')(e.target.value)} /></Field>
              <Field label="Original title" htmlFor="em-orig" className="sm:col-span-2"><Input id="em-orig" lang="ja" value={f.original_title} onChange={(e) => set('original_title')(e.target.value)} /></Field>
              <Field label="Category" htmlFor="em-cat" hint={f.category !== m.category ? 'The title will move to another section. Its history is kept.' : undefined}>
                <Select id="em-cat" value={f.category} onValueChange={(v) => setF((s) => ({ ...s, category: v as MediaCategory }))} options={CATEGORY_LIST.map((c) => ({ value: c.id, label: c.label }))} />
              </Field>
              <Field label="Format" htmlFor="em-format" error={!formatValid ? 'Not valid for this category — it will be cleared' : undefined}>
                <Select id="em-format" value={formatValid ? f.format : 'none'} onValueChange={set('format')} options={[{ value: 'none', label: '—' }, ...cfg.formats]} />
              </Field>
            </div>
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-fg-2">Alternative titles</h3>
            <ul className="flex flex-col gap-1">
              {titles.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Select size="sm" aria-label="Title kind" value={t.kind} onValueChange={(v) => setTitles((ts) => ts.map((x, j) => (j === i ? { ...x, kind: v as TitleKind } : x)))} options={KINDS.map((k) => ({ value: k, label: k }))} className="w-28" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${t.title}`} onClick={() => setTitles((ts) => ts.filter((_, j) => j !== i))}><X /></Button>
                </li>
              ))}
            </ul>
            <div className="mt-1.5 flex gap-2">
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a title (any language)" aria-label="New alternative title"
                onKeyDown={(e) => { if (e.key === 'Enter' && newTitle.trim()) { setTitles((ts) => [...ts, { title: newTitle.trim(), kind: guessTitleKind(newTitle) }]); setNewTitle('') } }} />
              <Button size="md" disabled={!newTitle.trim()} onClick={() => { setTitles((ts) => [...ts, { title: newTitle.trim(), kind: guessTitleKind(newTitle) }]); setNewTitle('') }}><Plus /> Add</Button>
            </div>
          </section>

          <Field label="Synopsis" htmlFor="em-syn"><Textarea id="em-syn" rows={4} value={f.synopsis} onChange={(e) => set('synopsis')(e.target.value)} /></Field>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Year" htmlFor="em-year"><Input id="em-year" type="number" value={f.release_year} onChange={(e) => set('release_year')(e.target.value)} /></Field>
            <Field label="Release date" htmlFor="em-rd"><Input id="em-rd" type="date" value={f.release_date} onChange={(e) => set('release_date')(e.target.value)} /></Field>
            <Field label="End date" htmlFor="em-ed"><Input id="em-ed" type="date" value={f.end_date} onChange={(e) => set('end_date')(e.target.value)} /></Field>
            <Field label="Release status" htmlFor="em-rs">
              <Select id="em-rs" value={f.release_status} onValueChange={set('release_status')} options={[{ value: 'none', label: '—' }, ...Object.entries(RELEASE_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {cfg.progress === 'episodes' && <Field label="Episodes" htmlFor="em-te"><Input id="em-te" type="number" placeholder="Unknown" value={f.total_episodes} onChange={(e) => set('total_episodes')(e.target.value)} /></Field>}
            {cfg.seasons && <Field label="Seasons" htmlFor="em-ts"><Input id="em-ts" type="number" placeholder="Unknown" value={f.total_seasons} onChange={(e) => set('total_seasons')(e.target.value)} /></Field>}
            {cfg.progress === 'chapters' && <Field label="Chapters" htmlFor="em-tc"><Input id="em-tc" type="number" placeholder="Unknown" value={f.total_chapters} onChange={(e) => set('total_chapters')(e.target.value)} /></Field>}
            {cfg.volumes && <Field label="Volumes" htmlFor="em-tv"><Input id="em-tv" type="number" placeholder="Unknown" value={f.total_volumes} onChange={(e) => set('total_volumes')(e.target.value)} /></Field>}
            {cfg.progress === 'routes' && <Field label="Routes" htmlFor="em-tr"><Input id="em-tr" type="number" placeholder="Unknown" value={f.total_routes} onChange={(e) => set('total_routes')(e.target.value)} /></Field>}
            <Field label="Country" htmlFor="em-country" hint={COUNTRY_LABEL[f.country.toUpperCase()]}><Input id="em-country" maxLength={2} value={f.country} onChange={(e) => set('country')(e.target.value)} /></Field>
          </div>
          <Field label="Genres" htmlFor="em-genres" hint="Comma separated"><Input id="em-genres" value={f.genres} onChange={(e) => set('genres')(e.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {CREDIT_KEYS[f.category].map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)} htmlFor={`em-${k}`} hint="Comma separated">
                <Input id={`em-${k}`} value={credits[k] ?? ''} onChange={(e) => setCredits((c) => ({ ...c, [k]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cover URL" htmlFor="em-purl"><Input id="em-purl" type="url" value={f.poster_url} onChange={(e) => set('poster_url')(e.target.value)} /></Field>
            <Field label="Backdrop URL" htmlFor="em-burl" hint={m.custom_backdrop_path && !removeCustomBackdrop ? 'A custom uploaded backdrop is used instead.' : undefined}>
              <div className="flex gap-1.5">
                <Input id="em-burl" type="url" value={f.backdrop_url} onChange={(e) => set('backdrop_url')(e.target.value)} />
                <label className="flex shrink-0 cursor-pointer items-center rounded-md border border-line px-2 text-fg-3 hover:text-fg" title="Upload backdrop">
                  <ImagePlus className="size-4" /><span className="sr-only">Upload backdrop</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(ev) => { setBackdropFile(ev.target.files?.[0] ?? null); setRemoveCustomBackdrop(false) }} />
                </label>
                {(m.custom_backdrop_path || backdropFile) && !removeCustomBackdrop && (
                  <Button size="icon" variant="ghost" aria-label="Remove uploaded backdrop" onClick={() => { setBackdropFile(null); setRemoveCustomBackdrop(true) }}><Trash2 /></Button>
                )}
              </div>
            </Field>
          </div>
          {errors.length > 0 && <ul className="text-[13px] text-danger" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={errors.length > 0} onClick={() => void save()}>Save changes</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
