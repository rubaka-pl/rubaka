/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { ArrowLeft, Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageContainer } from '@/components/layout/AppShell'
import { PosterCard, PosterGrid } from '@/components/media/PosterCard'
import { PerRowControl } from '@/components/media/PosterSizeControl'
import { PosterImage } from '@/components/media/PosterImage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/misc'
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/overlays'
import { usePerRow } from '@/features/settings/settings-store'
import { useLibrary } from '@/features/tracking/api'
import { useDebounced } from '@/features/tracking/hooks'
import { CATEGORY_CONFIG, CATEGORY_LIST } from '@/lib/categories'
import { posterSrc } from '@/lib/supabase'
import type { LibraryItem } from '@/types/db'
import { useFranchise, useFranchiseMutations } from './api'

const RELATION_LABEL: Record<string, string> = {
  sequel: 'Sequel', prequel: 'Prequel', parent: 'Main story', adaptation: 'Adaptation', source: 'Source',
  side_story: 'Side story', spin_off: 'Spin-off', alternative: 'Alternative version', summary: 'Summary', character: 'Related', other: 'Related',
}

export function FranchisePage() {
  const { id } = useParams()
  const q = useFranchise(id)
  const m = useFranchiseMutations()
  const navigate = useNavigate()
  const perRow = usePerRow()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [manage, setManage] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  if (q.isLoading) return <PageContainer><Skeleton className="h-10 w-1/3" /><Skeleton className="mt-6 h-64" /></PageContainer>
  if (q.isError) return <PageContainer><ErrorState error={q.error} onRetry={() => void q.refetch()} /></PageContainer>
  if (!q.data) return <PageContainer><EmptyState title="Franchise not found" action={<Button asChild><Link to="/franchises">All franchises</Link></Button>} /></PageContainer>

  const { franchise, items, missing } = q.data
  const completed = items.filter((i) => i.status === 'completed').length
  const total = items.length + missing.length
  const rated = items.filter((i) => i.rating != null)
  const avg = rated.length ? Math.round((rated.reduce((a, i) => a + i.rating!, 0) / rated.length / 2) * 10) / 10 : null
  const byCat = CATEGORY_LIST.map((c) => ({ c, list: items.filter((i) => i.category === c.id) })).filter((g) => g.list.length)
  const saveName = () => {
    if (name.trim() && name.trim() !== franchise.name) m.rename.mutate({ id: franchise.id, name })
    setEditing(false)
  }

  return (
    <PageContainer className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/franchises')}><ArrowLeft /> Franchises</Button>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <form className="flex max-w-xl items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveName() }}>
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-label="Franchise name" className="text-lg font-semibold" />
              <Button type="submit" size="icon" variant="primary" aria-label="Save name"><Check /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Cancel" onClick={() => setEditing(false)}><X /></Button>
            </form>
          ) : (
            <h1 className="group flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {franchise.name}
              <button onClick={() => { setName(franchise.name); setEditing(true) }} className="rounded p-1 text-fg-3 opacity-60 hover:bg-surface-hover hover:text-fg group-hover:opacity-100" aria-label="Rename franchise"><Pencil className="size-4" /></button>
            </h1>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
            <span className="tabular-nums">{items.length} in library{missing.length ? ` · ${missing.length} not yet` : ''}</span>
            <span className="text-fg-3">·</span>
            <span className="tabular-nums">{completed} of {total} completed</span>
            {avg != null && <><span className="text-fg-3">·</span><span>avg ★ {avg}</span></>}
            {byCat.map(({ c, list }) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]"><c.icon className="size-3" />{c.label} {list.length}</span>
            ))}
          </div>
          <ProgressBar ratio={total ? completed / total : 0} className="mt-3 max-w-md" label="Franchise completed" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PerRowControl className="hidden sm:flex" />
          <Button variant="secondary" onClick={() => setAddOpen(true)}><Plus /> Add titles</Button>
          <Button variant={manage ? 'primary' : 'ghost'} onClick={() => setManage((v) => !v)}>{manage ? 'Done' : 'Edit list'}</Button>
          <Button variant="ghost" size="icon" aria-label="Delete franchise" onClick={() => setDeleteOpen(true)}><Trash2 /></Button>
        </div>
      </header>

      {items.length === 0 && <EmptyState title="No titles yet" description="Add titles from your library." action={<Button variant="primary" onClick={() => setAddOpen(true)}><Plus /> Add titles</Button>} />}

      {byCat.map(({ c, list }) => (
        <section key={c.id} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><c.icon className="size-4 text-accent-hover" />{c.label}<span className="text-[12px] font-normal text-fg-3">{list.length}</span></h2>
          <PosterGrid perRow={perRow}>
            {(variant) => list.map((it) => (
              <div key={it.entry_id} className="relative">
                <PosterCard item={it} variant={variant} />
                {manage && (
                  <button onClick={() => m.setMember.mutate({ mediaId: it.media_id, franchiseId: null })}
                    className="absolute -right-1.5 -top-1.5 z-10 flex size-6 items-center justify-center rounded-full bg-danger text-white shadow-md hover:scale-110"
                    aria-label={`Remove ${it.title} from franchise`}><X className="size-3.5" /></button>
                )}
              </div>
            ))}
          </PosterGrid>
        </section>
      ))}

      {missing.length > 0 && (
        <section className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Not in your library <span className="text-[12px] font-normal text-fg-3">{missing.length}</span></h2>
            <Button size="sm" variant="secondary" disabled={m.addMissing.isPending}
              onClick={async () => { for (const it of missing) await m.addMissing.mutateAsync({ franchiseId: franchise.id, item: it }).catch(() => {}) }}>
              <Plus /> Add all to Planning
            </Button>
          </div>
          <p className="-mt-1 text-[12px] text-fg-3">Sequels, prequels, adaptations and side stories (AniList, VNDB), the rest of a movie collection (TMDB) or game franchise (IGDB). Adding one may reveal more.</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
            {missing.map((it) => {
              const cfg = it.category ? CATEGORY_CONFIG[it.category] : null
              const href = it.provider === 'anilist' ? `https://anilist.co/${it.category === 'anime' ? 'anime' : 'manga'}/${it.external_id}` : it.provider === 'vndb' ? `https://vndb.org/${it.external_id}`
                  : it.provider === 'tmdb_movie' ? `https://www.themoviedb.org/movie/${it.external_id}` : null
              return (
                <div key={`${it.provider}:${it.external_id}`} className="flex gap-3 rounded-lg border border-line bg-surface p-2">
                  <a href={href ?? undefined} target="_blank" rel="noreferrer" className="w-12 shrink-0 opacity-80 hover:opacity-100">
                    <PosterImage src={it.poster_url} title={it.title ?? ''} category={it.category ?? undefined} className="rounded" />
                  </a>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="line-clamp-2 text-[13px] font-medium leading-tight">{it.title}</div>
                    <div className="truncate text-[11px] text-fg-3">{cfg?.singular ?? it.provider} · {RELATION_LABEL[it.relation_type]} of {it.via_title}</div>
                    <Button size="sm" variant="ghost" className="mt-auto self-start px-1.5" disabled={m.addMissing.isPending}
                      onClick={() => m.addMissing.mutate({ franchiseId: franchise.id, item: it })}><Plus /> Add</Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {addOpen && <AddTitlesDialog open={addOpen} onOpenChange={setAddOpen} franchiseId={franchise.id} members={items} />}
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} destructive title={`Delete franchise “${franchise.name}”?`}
        description="Only the group is deleted — every title stays in your library. These titles will not be grouped automatically again."
        confirmLabel="Delete franchise" onConfirm={async () => { await m.remove.mutateAsync(franchise.id); navigate('/franchises', { replace: true }) }} />
    </PageContainer>
  )
}

function AddTitlesDialog({ open, onOpenChange, franchiseId, members }: { open: boolean; onOpenChange: (o: boolean) => void; franchiseId: string; members: LibraryItem[] }) {
  const [search, setSearch] = useState(members[0]?.title.split(/[:(\-–]/)[0].trim() ?? '')
  const term = useDebounced(search, 250)
  const res = useLibrary({ search: term, sort: 'relevance', limit: 30 }, term.trim().length >= 2)
  const m = useFranchiseMutations()
  const memberIds = new Set(members.map((i) => i.media_id))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Add titles" description="Search your whole library — any category." wide>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title…" className="pl-8" aria-label="Search library" />
        </div>
        <ul className="flex flex-col gap-1">
          {(res.data?.items ?? []).map((it) => {
            const inThis = memberIds.has(it.media_id)
            const cfg = CATEGORY_CONFIG[it.category]
            return (
              <li key={it.entry_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-hover">
                <div className="w-9 shrink-0"><PosterImage src={posterSrc(it)} title={it.title} category={it.category} className="rounded" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{it.title}</div>
                  <div className="flex items-center gap-1 text-[11px] text-fg-3"><cfg.icon className="size-3" />{cfg.singular}{it.release_year ? ` · ${it.release_year}` : ''}</div>
                </div>
                {inThis ? <span className="text-[12px] text-success">Added</span> : (
                  <Button size="sm" variant="secondary" onClick={() => m.setMember.mutate({ mediaId: it.media_id, franchiseId })}><Plus /> Add</Button>
                )}
              </li>
            )
          })}
          {term.trim().length >= 2 && res.data && !res.data.items.length && <li className="py-6 text-center text-[13px] text-fg-3">Nothing found in your library.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
