/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { ArrowLeft, Bookmark, Ellipsis, ExternalLink, Heart, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PosterImage } from '@/components/media/PosterImage'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, ErrorState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlays'
import { useDeleteMedia, useMediaDetail, type MediaDetail } from '@/features/tracking/api'
import { useEntryActions } from '@/features/tracking/hooks'
import { enrichOne } from '@/features/enrichment/runner'
import { CATEGORY_CONFIG, formatLabel, RELEASE_STATUS_LABEL } from '@/lib/categories'
import { backdropSrc, posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DetailsList, Overview } from './OverviewTab'
import { HistoryTab } from './HistoryTab'
import { NotesTab } from './NotesTab'
import { RelationsTab } from './RelationsTab'
import { RoutesPanel, SeasonsPanel } from './ProgressPanels'
import { TrackingPanel, toTracked } from './TrackingPanel'
import { EditMediaDialog } from './EditMediaDialog'
import { CoverDrop } from './CoverDrop'
import { FranchiseControl } from '@/features/franchises/FranchiseControl'
import { useSettings } from '@/features/settings/settings-store'
import { invalidateLibrary } from '@/features/tracking/api'
import { friendlyError } from '@/lib/supabase'

export function MediaDetailPage() {
  const { id } = useParams()
  const q = useMediaDetail(id)
  if (q.isLoading) return <DetailSkeleton />
  if (q.isError) return <div className="p-6"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <div className="p-6"><EmptyState title="Title not found" description="It may have been deleted." action={<Button asChild><Link to="/">Back to dashboard</Link></Button>} /></div>
  return <Detail d={q.data} />
}

function Detail({ d }: { d: MediaDetail }) {
  const { media, entry } = d
  const blurAdult = useSettings().blurAdult
  const cfg = CATEGORY_CONFIG[media.category]
  const navigate = useNavigate()
  const actions = useEntryActions()
  const del = useDeleteMedia()
  const qc = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const backdrop = backdropSrc(media) ?? posterSrc(media)
  const usingPosterAsBackdrop = !backdropSrc(media)
  const tracked = entry ? toTracked(d) : null
  // Provider-flagged adult covers are blurred only if the owner enabled it in Settings.
  const adultBlur = media.details?.is_adult === true && blurAdult

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await enrichOne(media, d.externalIds)
      invalidateLibrary(qc, media.id)
      if (res.status === 'matched') toast.success(res.changed.length ? `Filled: ${res.changed.join(', ')}` : 'Metadata is already complete')
      else if (res.status === 'review') toast('Several possible matches — review them on the Import page (Metadata tab).')
      else toast(res.message ?? 'No match found. You can edit the metadata manually.')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setRefreshing(false)
    }
  }

  const meta = [
    formatLabel(media.category, media.format),
    media.release_year,
    cfg.progress === 'episodes' && media.total_episodes ? `${media.total_episodes} episodes` : null,
    cfg.progress === 'chapters' && media.total_chapters ? `${media.total_chapters} chapters` : null,
    cfg.volumes && media.total_volumes ? `${media.total_volumes} volumes` : null,
    cfg.seasons && media.total_seasons ? `${media.total_seasons} seasons` : null,
    media.details?.studios?.[0] ?? media.details?.developers?.[0] ?? media.details?.authors?.[0] ?? media.details?.directors?.[0],
    media.release_status ? RELEASE_STATUS_LABEL[media.release_status] : null,
  ].filter(Boolean)

  const extraTab = cfg.seasons ? 'seasons' : cfg.progress === 'routes' ? 'routes' : null

  return (
    <div className="relative">
      {/* Backdrop */}
      <div className="absolute inset-x-0 top-0 h-[300px] overflow-hidden sm:h-[360px]" aria-hidden>
        {backdrop && (
          <img src={backdrop} alt="" referrerPolicy="no-referrer"
            className={cn('size-full object-cover object-[center_25%]', usingPosterAsBackdrop && 'scale-110 blur-2xl opacity-60', adultBlur && 'blur-2xl')} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-bg/30 via-bg/70 to-bg" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg/80 via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto max-w-[1500px] px-4 pb-10 sm:px-6">
        <div className="pt-3">
          <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/${cfg.slug}`))} className="bg-black/30 text-white/90 backdrop-blur hover:bg-black/50 hover:text-white">
            <ArrowLeft /> Back
          </Button>
        </div>

        <div className="mt-[120px] flex flex-col gap-5 sm:mt-[150px] md:flex-row md:items-end">
          <div className={cn('w-36 shrink-0 sm:w-44', adultBlur && '[&_img]:blur-xl')}>
            <CoverDrop media={media}>
              <PosterImage src={posterSrc(media)} title={media.title} category={media.category} eager className="shadow-card ring-1 ring-white/10" />
            </CoverDrop>
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/${cfg.slug}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent-hover hover:underline"><cfg.icon className="size-3.5" /> {cfg.singular}</Link>
                <h1 className="mt-1 text-2xl font-bold leading-tight tracking-tight sm:text-[32px]">{media.title}</h1>
                {media.original_title && media.original_title !== media.title && (
                  <p className="mt-0.5 text-[15px] text-fg-2" lang="ja">{media.original_title}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {tracked && (
                  <>
                    <Button variant={entry!.wishlisted_at ? 'primary' : 'secondary'} size="icon" aria-pressed={!!entry!.wishlisted_at}
                      aria-label={entry!.wishlisted_at ? 'Remove from Wishlist' : 'Add to Wishlist'} onClick={() => actions.toggleWishlist(tracked)}>
                      <Bookmark className={cn(entry!.wishlisted_at && 'fill-current')} />
                    </Button>
                    <Button variant="secondary" size="icon" aria-pressed={entry!.is_favorite} aria-label={entry!.is_favorite ? 'Remove favorite' : 'Mark favorite'} onClick={() => actions.toggleFavorite(tracked)}>
                      <Heart className={cn(entry!.is_favorite && 'fill-danger text-danger')} />
                    </Button>
                  </>
                )}
                <Button variant="primary" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
                <Menu>
                  <MenuTrigger asChild><Button variant="secondary" size="icon" aria-label="More actions"><Ellipsis /></Button></MenuTrigger>
                  <MenuContent>
                    {!media.is_custom && <MenuItem onSelect={() => void refresh()} disabled={refreshing}><RefreshCw /> Fill missing metadata</MenuItem>}
                    {d.externalIds.filter((x) => x.url).map((x) => (
                      <MenuItem key={x.provider} asChild><a href={x.url!} target="_blank" rel="noreferrer"><ExternalLink /> Open on {x.provider.replace(/_(anime|manga|movie|tv)$/, '').toUpperCase()}</a></MenuItem>
                    ))}
                    <MenuSeparator />
                    <MenuItem destructive onSelect={() => setDeleteOpen(true)}><Trash2 /> Delete</MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-fg-2">
              {meta.map((m, i) => <span key={i} className="flex items-center gap-2.5">{i > 0 && <span className="text-fg-3" aria-hidden>·</span>}{m}</span>)}
            </div>
            {d.genres.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.genres.map((g) => <Link key={g} to={`/${cfg.slug}?genres=${encodeURIComponent(g)}`}><Badge className="hover:bg-accent-soft hover:text-fg">{g}</Badge></Link>)}
              </div>
            )}
            <FranchiseControl media={media} />
          </div>
        </div>

        {entry ? <TrackingPanel d={d} /> : (
          <EmptyState className="mt-6" title="Not in your library" description="This title has no library entry." />
        )}

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            {extraTab === 'seasons' && <TabsTrigger value="seasons">Seasons</TabsTrigger>}
            {extraTab === 'routes' && <TabsTrigger value="routes">Routes</TabsTrigger>}
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="relations">Relations{d.relations.length ? ` (${d.relations.length})` : ''}</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4"><Overview d={d} /></TabsContent>
          {extraTab === 'seasons' && <TabsContent value="seasons" className="pt-4"><SeasonsPanel d={d} /></TabsContent>}
          {extraTab === 'routes' && <TabsContent value="routes" className="pt-4"><RoutesPanel d={d} /></TabsContent>}
          <TabsContent value="history" className="pt-4"><HistoryTab d={d} /></TabsContent>
          <TabsContent value="details" className="pt-4"><DetailsList d={d} full /></TabsContent>
          <TabsContent value="relations" className="pt-4"><RelationsTab d={d} /></TabsContent>
          <TabsContent value="notes" className="pt-4"><NotesTab d={d} /></TabsContent>
        </Tabs>
      </div>

      {editOpen && <EditMediaDialog d={d} open={editOpen} onOpenChange={setEditOpen} />}
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} destructive title={`Delete “${media.title}”?`}
        description="The title, your rating, progress, history and notes will be removed permanently (unless restored from a backup)."
        confirmLabel="Delete" onConfirm={async () => { await del.mutateAsync([media.id]); navigate(`/${cfg.slug}`, { replace: true }) }} />
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] px-6 pt-[180px]" aria-busy>
      <div className="flex gap-5"><Skeleton className="aspect-[2/3] w-44" /><div className="flex flex-1 flex-col gap-3 pt-20"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4 w-1/3" /></div></div>
      <Skeleton className="mt-6 h-28" />
    </div>
  )
}
