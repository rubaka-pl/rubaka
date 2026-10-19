import { Bookmark, Ellipsis, Heart, Repeat } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router'
import { Checkbox } from '@/components/ui/form-controls'
import { Menu, MenuTrigger } from '@/components/ui/overlays'
import { ProgressBar } from '@/components/ui/misc'
import { StarRating } from '@/components/ratings/StarRating'
import { useEntryActions } from '@/features/tracking/hooks'
import { formatLabel, primaryProgress, statusLabel } from '@/lib/categories'
import { formatTimestamp } from '@/lib/dates'
import { posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryItem } from '@/types/db'
import { StatusDot } from './PosterCard'
import { PosterImage } from './PosterImage'
import { QuickActionsMenu, useQuickActionDialogs } from './QuickActions'

/** Dense table-like row; the rating is editable inline. */
export const MediaListRow = memo(function MediaListRow({ item, selectable, selected, onSelectChange }: {
  item: LibraryItem; selectable?: boolean; selected?: boolean; onSelectChange?: (id: string, v: boolean) => void
}) {
  const actions = useEntryActions()
  const { openEdit, openDelete, dialogs } = useQuickActionDialogs(item)
  const progress = primaryProgress(item)
  return (
    <div role="row" className={cn('group flex items-center gap-3 border-b border-line px-2 py-2 hover:bg-surface/70', selected && 'bg-accent-soft')}>
      {selectable && (
        <Checkbox checked={selected} onCheckedChange={(v) => onSelectChange?.(item.entry_id, v === true)} aria-label={`Select ${item.title}`} />
      )}
      <Link to={`/media/${item.media_id}`} className="w-9 shrink-0" tabIndex={-1} aria-hidden>
        <PosterImage src={posterSrc(item)} title="" category={item.category} className="rounded" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link to={`/media/${item.media_id}`} className="truncate text-[13px] font-semibold hover:text-accent-hover">{item.title}</Link>
          {item.is_favorite && <Heart className="size-3 shrink-0 fill-danger text-danger" aria-label="Favorite" />}
          {item.wishlisted_at && <Bookmark className="size-3 shrink-0 fill-accent-hover text-accent-hover" aria-label="In wishlist" />}
          {item.active_session_id && <Repeat className="size-3 shrink-0 text-accent-hover" aria-label="Repeat in progress" />}
        </div>
        <div className="truncate text-[11px] text-fg-3">
          {[item.release_year, formatLabel(item.category, item.format), item.original_title].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="hidden w-28 shrink-0 items-center gap-1.5 text-xs text-fg-2 md:flex">
        <StatusDot status={item.status} /> {statusLabel(item.status, item.category)}
      </div>
      <div className="hidden w-32 shrink-0 flex-col gap-1 lg:flex">
        {progress && progress.unit !== '' ? (
          <>
            <span className="text-[11px] tabular-nums text-fg-3">{progress.label}</span>
            <ProgressBar ratio={progress.ratio} />
          </>
        ) : <span className="text-[11px] text-fg-3">—</span>}
      </div>
      <div className="shrink-0">
        <StarRating value={item.rating} onChange={(v) => actions.setRating(item, v)} size="sm" label={`Rate ${item.title}`} />
      </div>
      <div className="hidden w-24 shrink-0 text-right text-[11px] text-fg-3 xl:block">{formatTimestamp(item.added_at)}</div>
      <Menu>
        <MenuTrigger asChild>
          <button className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-surface-hover hover:text-fg" aria-label={`Actions for ${item.title}`}>
            <Ellipsis className="size-4" />
          </button>
        </MenuTrigger>
        <QuickActionsMenu item={item} onEdit={openEdit} onDelete={openDelete} />
      </Menu>
      {dialogs}
    </div>
  )
})
