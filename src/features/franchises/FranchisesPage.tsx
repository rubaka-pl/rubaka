/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQueryClient } from '@tanstack/react-query'
import { Network, Plus, Search, Sparkles, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/AppShell'
import { PosterImage } from '@/components/media/PosterImage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { Select } from '@/components/ui/select'
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/misc'
import { Dialog, DialogContent } from '@/components/ui/overlays'
import { invalidateLibrary } from '@/features/tracking/api'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { friendlyError, posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { FranchiseSummary } from '@/types/db'
import { detectFranchises, franchiseKeys, useFranchiseList, useFranchiseMutations } from './api'

export function FranchisesPage() {
  const q = useFranchiseList()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'todo' | 'name' | 'size'>('todo')
  const [running, setRunning] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const list = useMemo(() => {
    const term = search.trim().toLowerCase()
    const left = (f: FranchiseSummary) => f.members + (f.missing ?? 0) - f.completed
    return (q.data ?? []).filter((f) => !term || f.name.toLowerCase().includes(term)).sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'size' ? b.members + (b.missing ?? 0) - (a.members + (a.missing ?? 0)) || a.name.localeCompare(b.name)
          // Unfinished first: something in progress, then most left to watch/read/play.
          : (b.in_progress > 0 ? 1 : 0) - (a.in_progress > 0 ? 1 : 0) || left(b) - left(a) || a.name.localeCompare(b.name))
  }, [q.data, search, sort])

  const detect = async () => {
    setRunning('Starting…')
    try {
      const r = await detectFranchises((msg, done, total) => setRunning(total ? `${msg} ${done} / ${total}` : msg))
      const found = [r.groups && `${r.groups} from relations`, r.single && `${r.single} with unseen sequels`, r.movies && `${r.movies} movie collections`, r.games && `${r.games} game franchises`].filter(Boolean).join(', ')
      toast.success(found ? `Franchises: ${found}${r.added ? ` · ${r.added} titles grouped` : ''}` : 'No new franchises found')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setRunning(null)
      qc.invalidateQueries({ queryKey: franchiseKeys.list })
      invalidateLibrary(qc)
    }
  }

  return (
    <PageContainer className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Franchises</h1>
          <p className="text-[13px] text-fg-3">Every series in one place — anime, manga, novels, visual novels, movies, shows and games together.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(true)}><Plus /> New franchise</Button>
          <Button variant="primary" onClick={() => void detect()} disabled={!!running}><Sparkles /> {running ?? 'Find franchises'}</Button>
        </div>
      </header>

      {(q.data?.length ?? 0) > 8 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search franchises" className="pl-8" aria-label="Search franchises" />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)} className="w-48" aria-label="Sort"
            options={[{ value: 'todo', label: 'Unfinished first' }, { value: 'size', label: 'Biggest first' }, { value: 'name', label: 'Name A–Z' }]} />
          <span className="text-[12px] text-fg-3">{list.length} franchises</span>
        </div>
      )}

      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : !q.data?.length ? (
        <EmptyState
          icon={<Network className="size-6" />}
          title="No franchises yet"
          description="“Find franchises” groups titles automatically: anime with their manga and novels (AniList, VNDB relations), movie collections (TMDB) and game series (IGDB). You can also make one by hand."
          action={<Button variant="primary" onClick={() => void detect()} disabled={!!running}><Sparkles /> {running ?? 'Find franchises'}</Button>}
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {list.map((f) => <FranchiseCard key={f.id} f={f} />)}
        </div>
      )}
      {createOpen && <CreateFranchiseDialog open={createOpen} onOpenChange={setCreateOpen} />}
    </PageContainer>
  )
}

function FranchiseCard({ f }: { f: FranchiseSummary }) {
  const posters = f.posters.slice(0, 4)
  return (
    <Link to={`/franchises/${f.id}`} className="group flex gap-3 rounded-xl border border-line bg-surface p-3 transition-colors hover:border-accent/60 hover:bg-surface-hover">
      {/* Fanned poster stack */}
      <div className="relative h-[120px] w-[104px] shrink-0">
        {posters.length === 0 && <PosterImage src={null} title={f.name} className="absolute left-0 top-0 w-[80px] rounded-md" />}
        {posters.map((p, i) => (
          <div key={i} className="absolute top-0 w-[80px] transition-transform duration-200 group-hover:translate-x-[calc(var(--i)*3px)]"
            style={{ left: i * 8, zIndex: posters.length - i, transform: `rotate(${(i - (posters.length - 1) / 2) * 3}deg)`, ['--i' as string]: i }}>
            <PosterImage src={posterSrc(p)} title={p.title} className="rounded-md shadow-[0_6px_16px_-6px_rgb(0_0_0/0.7)] ring-1 ring-white/10" />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="line-clamp-2 text-[14px] font-semibold leading-tight group-hover:text-accent-hover">{f.name}</div>
        <div className="flex flex-wrap gap-1">
          {f.categories.map((c) => {
            const cfg = CATEGORY_CONFIG[c]
            return <span key={c} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-fg-2"><cfg.icon className="size-3" />{cfg.label}</span>
          })}
        </div>
        <div className="mt-auto flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11.5px] text-fg-3">
            <span className="tabular-nums">{f.completed} / {f.members + (f.missing ?? 0)} completed{f.missing ? ` · +${f.missing} not added` : ''}</span>
            {f.avg_rating != null && <span className="inline-flex items-center gap-0.5 tabular-nums"><Star className="size-3 fill-rating text-rating" />{f.avg_rating}</span>}
          </div>
          <ProgressBar ratio={f.completed / Math.max(1, f.members + (f.missing ?? 0))} label={`${f.name} completed`} />
        </div>
      </div>
    </Link>
  )
}

export function CreateFranchiseDialog({ open, onOpenChange, mediaId, defaultName = '' }: {
  open: boolean; onOpenChange: (o: boolean) => void; mediaId?: string; defaultName?: string
}) {
  const [name, setName] = useState(defaultName)
  const m = useFranchiseMutations()
  const navigate = useNavigate()
  const submit = async () => {
    if (!name.trim()) return
    const f = await m.create.mutateAsync({ name, mediaIds: mediaId ? [mediaId] : [] })
    onOpenChange(false)
    if (!mediaId) navigate(`/franchises/${f.id}`)
    else toast.success(`Added to “${f.name}”`)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New franchise" description="Give it a name; add titles afterwards from the franchise page or any title's page.">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mushoku Tensei" aria-label="Franchise name" maxLength={200} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || m.create.isPending} className={cn(m.create.isPending && 'opacity-70')}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
