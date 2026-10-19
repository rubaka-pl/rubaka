/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { StatusSelect } from '@/components/media/EntryFields'
import { PosterImage } from '@/components/media/PosterImage'
import { StarRating } from '@/components/ratings/StarRating'
import { Button } from '@/components/ui/button'
import { Field, Input, Switch, Textarea } from '@/components/ui/form-controls'
import { Select } from '@/components/ui/select'
import { buildStatusPatch, invalidateLibrary } from '@/features/tracking/api'
import { guessTitleKind, uploadImage } from '@/lib/assets'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { STATUSES, type MediaCategory } from '@/types/db'

const optInt = z.preprocess((v) => (v === '' || v == null || Number.isNaN(v) ? null : Number(v)), z.number().int().positive('Must be a positive number').nullable())
const optCount = z.preprocess((v) => (v === '' || v == null || Number.isNaN(v) ? 0 : Number(v)), z.number().int().min(0))

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  // Optional, any script (Japanese, Chinese, Korean, Cyrillic...). Stored as typed.
  original_title: z.string().trim().max(500).optional(),
  alt_titles: z.string().optional(),
  synopsis: z.string().max(20000).optional(),
  poster_url: z.union([z.literal(''), z.string().trim().url('Enter a valid image URL')]).optional(),
  release_year: z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1800).max(2200).nullable()),
  release_date: z.string().optional(),
  format: z.string().optional(),
  genres: z.string().optional(),
  credits: z.string().optional(),
  total_episodes: optInt, total_chapters: optInt, total_volumes: optInt, total_seasons: optInt, total_routes: optInt,
  status: z.enum(STATUSES),
  rating: z.number().int().min(0).max(10).nullable(),
  progress: optCount,
  volumes: optCount,
  wishlist: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.release_date && v.release_year && Number(v.release_date.slice(0, 4)) !== v.release_year) {
    ctx.addIssue({ code: 'custom', path: ['release_date'], message: 'Release date and year disagree' })
  }
})

type Values = z.input<typeof schema>
type Parsed = z.output<typeof schema>

const CREDIT_FIELD: Record<MediaCategory, { key: string; label: string }> = {
  anime: { key: 'studios', label: 'Studios' },
  manga: { key: 'authors', label: 'Authors' },
  novel: { key: 'authors', label: 'Authors' },
  visual_novel: { key: 'developers', label: 'Developers' },
  movie: { key: 'directors', label: 'Directors' },
  tv_series: { key: 'creators', label: 'Creators' },
  animated_series: { key: 'creators', label: 'Creators' },
  game: { key: 'developers', label: 'Developers' },
}

const splitList = (s?: string) => (s ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

export function CustomMediaForm({ category, onCreated }: { category: MediaCategory; onCreated: () => void }) {
  const cfg = CATEGORY_CONFIG[category]
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const form = useForm<Values, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', original_title: '', alt_titles: '', synopsis: '', poster_url: '', release_year: '' as unknown as null, release_date: '', format: '', genres: '', credits: '', status: 'planning', rating: null, progress: 0, volumes: 0, wishlist: false },
  })
  const e = form.formState.errors
  const totalField: Record<string, 'total_episodes' | 'total_chapters' | 'total_routes' | null> = { episodes: 'total_episodes', chapters: 'total_chapters', routes: 'total_routes', single: null, none: null }
  const primaryTotal = totalField[cfg.progress]

  const submit = form.handleSubmit(async (v) => {
    try {
      const custom_poster_path = file ? await uploadImage(file, 'poster') : null
      const credits = splitList(v.credits)
      const primary = cfg.progress === 'episodes' ? 'episodes_watched' : cfg.progress === 'chapters' ? 'chapters_read' : cfg.progress === 'routes' ? 'routes_completed' : null
      const totals = { total_episodes: v.total_episodes, total_chapters: v.total_chapters, total_volumes: v.total_volumes, total_routes: v.total_routes }
      const entry = {
        ...buildStatusPatch({ category, status: 'planning', start_date: null, completion_date: null, episodes_watched: 0, chapters_read: 0, volumes_read: 0, routes_completed: 0, ...totals }, v.status),
        status: v.status,
        rating: v.rating,
        ...(primary && v.progress ? { [primary]: v.progress } : {}),
        ...(cfg.volumes && v.volumes ? { volumes_read: v.volumes } : {}),
        wishlisted_at: v.wishlist ? new Date().toISOString() : null,
      }
      const media: Record<string, unknown> = {
        category,
        title: v.title,
        ...(v.original_title ? { original_title: v.original_title } : {}),
        ...(v.synopsis?.trim() ? { synopsis: v.synopsis.trim() } : {}),
        ...(v.poster_url ? { poster_url: v.poster_url } : {}),
        ...(custom_poster_path ? { custom_poster_path } : {}),
        ...(v.release_year ? { release_year: v.release_year } : {}),
        ...(v.release_date ? { release_date: v.release_date } : {}),
        ...(v.format ? { format: v.format } : {}),
        ...Object.fromEntries(Object.entries({ ...totals, total_seasons: v.total_seasons }).filter(([, x]) => x != null)),
        details: credits.length ? { [CREDIT_FIELD[category].key]: credits } : {},
      }
      // One alternative title per line (titles may contain commas).
      const titles = (v.alt_titles ?? '').split('\n').map((t) => t.trim()).filter(Boolean)
        .map((t) => ({ title: t, kind: guessTitleKind(t) }))
      const res = unwrap(await supabase.rpc('create_media_entry', {
        p_media: media, p_entry: entry, p_titles: titles, p_genres: splitList(v.genres), p_external_ids: [], p_is_custom: true,
      }), 'create custom') as { media_id: string }
      invalidateLibrary(qc)
      toast.success(`Created “${v.title}”`, { action: { label: 'Open', onClick: () => navigate(`/media/${res.media_id}`) } })
      onCreated()
    } catch (err) {
      form.setError('root', { message: friendlyError(err) })
    }
  })

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          <PosterImage src={preview ?? (form.watch('poster_url') || null)} title={form.watch('title') || cfg.singular} category={category} />
          <label className="mt-1.5 flex cursor-pointer items-center justify-center gap-1 rounded border border-dashed border-line py-1 text-[11px] text-fg-3 hover:text-fg">
            <ImagePlus className="size-3.5" /> Upload
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(ev) => {
              const f = ev.target.files?.[0] ?? null
              setFile(f)
              setPreview(f ? URL.createObjectURL(f) : null)
            }} />
          </label>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Field label="Title *" htmlFor="cm-title" error={e.title?.message}>
            <Input id="cm-title" {...form.register('title')} autoFocus />
          </Field>
          <Field label="Original title (optional)" htmlFor="cm-orig" hint="Any script works, e.g. 薬屋のひとりごと. Searchable from the library and Ctrl+K." error={e.original_title?.message}>
            <Input id="cm-orig" lang="ja" {...form.register('original_title')} />
          </Field>
        </div>
      </div>
      <Field label="Alternative titles" htmlFor="cm-alt" hint="One per line (romaji, English, Russian…). The script is detected automatically.">
        <Textarea id="cm-alt" rows={2} className="min-h-14" {...form.register('alt_titles')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Format" htmlFor="cm-format">
          <Controller control={form.control} name="format" render={({ field }) => (
            <Select id="cm-format" value={field.value || 'none'} onValueChange={(x) => field.onChange(x === 'none' ? '' : x)}
              options={[{ value: 'none', label: '—' }, ...cfg.formats]} className="w-full" />
          )} />
        </Field>
        <Field label="Release year" htmlFor="cm-year" error={e.release_year?.message}>
          <Input id="cm-year" type="number" {...form.register('release_year')} />
        </Field>
        <Field label="Release date" htmlFor="cm-date" error={e.release_date?.message}>
          <Input id="cm-date" type="date" {...form.register('release_date')} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Genres" htmlFor="cm-genres" hint="Comma separated">
          <Input id="cm-genres" {...form.register('genres')} />
        </Field>
        <Field label={CREDIT_FIELD[category].label} htmlFor="cm-credits" hint="Comma separated">
          <Input id="cm-credits" {...form.register('credits')} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cfg.progress === 'episodes' && <Field label="Total episodes" htmlFor="cm-te" error={e.total_episodes?.message}><Input id="cm-te" type="number" placeholder="Unknown" {...form.register('total_episodes')} /></Field>}
        {cfg.seasons && <Field label="Total seasons" htmlFor="cm-ts" error={e.total_seasons?.message}><Input id="cm-ts" type="number" placeholder="Unknown" {...form.register('total_seasons')} /></Field>}
        {cfg.progress === 'chapters' && <Field label="Total chapters" htmlFor="cm-tc" error={e.total_chapters?.message}><Input id="cm-tc" type="number" placeholder="Unknown" {...form.register('total_chapters')} /></Field>}
        {cfg.volumes && <Field label="Total volumes" htmlFor="cm-tv" error={e.total_volumes?.message}><Input id="cm-tv" type="number" placeholder="Unknown" {...form.register('total_volumes')} /></Field>}
        {cfg.progress === 'routes' && <Field label="Total routes" htmlFor="cm-tr" error={e.total_routes?.message}><Input id="cm-tr" type="number" placeholder="Unknown" {...form.register('total_routes')} /></Field>}
      </div>
      <Field label="Synopsis" htmlFor="cm-syn"><Textarea id="cm-syn" rows={3} {...form.register('synopsis')} /></Field>
      <Field label="Cover image URL" htmlFor="cm-poster" hint="Or upload a file on the left (uploads take precedence)." error={e.poster_url?.message}>
        <Input id="cm-poster" type="url" placeholder="https://…" {...form.register('poster_url')} />
      </Field>

      <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="cm-status">
          <Controller control={form.control} name="status" render={({ field }) => <StatusSelect id="cm-status" category={category} value={field.value} onChange={field.onChange} />} />
        </Field>
        <Field label="Rating">
          <Controller control={form.control} name="rating" render={({ field }) => <StarRating value={field.value} onChange={field.onChange} showControls showValue />} />
        </Field>
        {primaryTotal && (
          <Field label={cfg.progress === 'episodes' ? 'Episodes watched' : cfg.progress === 'chapters' ? 'Chapters read' : 'Routes completed'} htmlFor="cm-prog">
            <Input id="cm-prog" type="number" min={0} {...form.register('progress')} className="w-28" />
          </Field>
        )}
        {cfg.volumes && <Field label="Volumes read" htmlFor="cm-vol"><Input id="cm-vol" type="number" min={0} {...form.register('volumes')} className="w-28" /></Field>}
        <label className="flex items-center gap-2 text-[13px]">
          <Controller control={form.control} name="wishlist" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />} /> Add to Wishlist
        </label>
      </div>
      {e.root && <p className="text-[13px] text-danger" role="alert">{e.root.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>Create {cfg.singular.toLowerCase()}</Button>
      </div>
    </form>
  )
}
