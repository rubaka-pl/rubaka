/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { Bookmark, Ellipsis, Heart, Plus, Repeat } from 'lucide-react'
import { memo, useCallback, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Checkbox } from '@/components/ui/form-controls'
import { Menu, MenuTrigger, Tooltip } from '@/components/ui/overlays'
import { ProgressBar } from '@/components/ui/misc'
import { StarRating } from '@/components/ratings/StarRating'
import { canIncrement, useCanHover, useEntryActions } from '@/features/tracking/hooks'
import { CATEGORY_CONFIG, formatLabel, primaryProgress, statusLabel } from '@/lib/categories'
import { posterSrc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryItem, LibraryStatus } from '@/types/db'
import { COMPACT_BELOW, MIN_CARD_PX } from '@/features/settings/settings-store'
import { PosterImage } from './PosterImage'
import { QuickActionsMenu, useQuickActionDialogs } from './QuickActions'

export const STATUS_DOT: Record<LibraryStatus, string> = {
  planning: 'bg-fg-3',
  in_progress: 'bg-accent',
  completed: 'bg-success',
  on_hold: 'bg-warning',
  dropped: 'bg-danger',
}

export function StatusDot({ status, className }: { status: LibraryStatus; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', STATUS_DOT[status], className)} aria-hidden />
}

interface CardProps {
  item: LibraryItem
  variant?: 'grid' | 'compact'
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (id: string, selected: boolean) => void
  /** Show the category name (dashboard / cross-category lists). */
  showCategory?: boolean
  eager?: boolean
}

export const PosterCard = memo(function PosterCard({ item, variant = 'grid', selectable, selected, onSelectChange, showCategory, eager }: CardProps) {
  const actions = useEntryActions()
  const canHover = useCanHover()
  const { openEdit, openDelete, dialogs } = useQuickActionDialogs(item)
  const progress = primaryProgress(item)
  const showProgressBar = progress && progress.unit !== '' && (item.status === 'in_progress' || item.status === 'on_hold' || item.active_session_id)
  const subtitle = cardSubtitle(item, progress)
  const compact = variant === 'compact'
  const href = `/media/${item.media_id}`

  return (
    <article className="group relative flex min-w-0 flex-col" aria-label={item.title}>
      <div className="relative">
        <Link to={href} className="block rounded-md focus-visible:outline-offset-2" tabIndex={selectable ? -1 : 0}>
          <PosterImage
            src={posterSrc(item)}
            title={item.title}
            category={item.category}
            eager={eager}
            className={cn(
              'rounded-lg shadow-[0_4px_14px_-6px_rgb(0_0_0/0.6)] ring-1 ring-white/[0.06] transition-[transform,box-shadow] duration-200',
              canHover && 'group-hover:-translate-y-1 group-hover:shadow-[0_14px_32px_-12px_rgb(139_108_240/0.55)] group-hover:ring-accent/50',
            )}
          />
        </Link>

        {/* Top-left: selection or status/flags */}
        <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1">
          {selectable ? (
            <span className="pointer-events-auto rounded bg-black/60 p-1">
              <Checkbox checked={selected} onCheckedChange={(v) => onSelectChange?.(item.entry_id, v === true)} aria-label={`Select ${item.title}`} />
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
              <StatusDot status={item.status} />
              {!compact && statusLabel(item.status, item.category)}
            </span>
          )}
          {item.active_session_id && (
            <Tooltip content={`${CATEGORY_CONFIG[item.category].repeatLabel} in progress`}>
              <span className="pointer-events-auto rounded bg-accent/90 p-0.5 text-white"><Repeat className="size-3" /></span>
            </Tooltip>
          )}
        </div>
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {item.is_favorite && <span className="rounded bg-black/65 p-1"><Heart className="size-3 fill-danger text-danger" aria-label="Favorite" /></span>}
          {item.wishlisted_at && <span className="rounded bg-black/65 p-1"><Bookmark className="size-3 fill-accent-hover text-accent-hover" aria-label="In wishlist" /></span>}
        </div>

        {/* Quick actions: on hover for mouse users, always visible on touch devices. */}
        {!selectable && (
          <div className={cn(
            'absolute inset-x-1.5 bottom-1.5 flex items-center justify-end gap-1 transition-opacity',
            canHover ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : 'opacity-100',
          )}>
            {canIncrement(item) && canHover && (
              <QuickButton label="+1" onClick={() => actions.increment(item)}><Plus /></QuickButton>
            )}
            {canHover && (
              <QuickButton label={item.wishlisted_at ? 'Remove from Wishlist' : 'Add to Wishlist'} onClick={() => actions.toggleWishlist(item)}>
                <Bookmark className={cn(item.wishlisted_at && 'fill-current')} />
              </QuickButton>
            )}
            <Menu>
              <MenuTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded-md bg-black/70 text-white backdrop-blur-sm hover:bg-accent" aria-label={`Actions for ${item.title}`}>
                  <Ellipsis className="size-4" />
                </button>
              </MenuTrigger>
              <QuickActionsMenu item={item} onEdit={openEdit} onDelete={openDelete} />
            </Menu>
          </div>
        )}
      </div>

      <div className={cn('mt-1.5 flex min-w-0 flex-col', compact ? 'gap-0.5' : 'gap-1')}>
        <Link to={href} className={cn('line-clamp-1 font-semibold leading-tight hover:text-accent-hover', compact ? 'text-[11px]' : 'text-[12.5px]')} title={item.title}>
          {item.title}
        </Link>
        {!compact && (
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-3">
            {showCategory && <span className="truncate">{CATEGORY_CONFIG[item.category].singular}</span>}
            {showCategory && subtitle && <span aria-hidden>·</span>}
            <span className="truncate tabular-nums">{subtitle}</span>
          </div>
        )}
        {showProgressBar && <ProgressBar ratio={progress!.ratio} label={`Progress ${progress!.label}`} />}
        {/* Rate right from the card (hover to preview, click/tap to save) — like Backloggd. */}
        <StarRating
          value={item.rating}
          onChange={(v) => actions.setRating(item, v)}
          size={compact ? 'xs' : 'sm'}
          label={`Rate ${item.title}`}
          className={cn(item.rating == null && 'opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100')}
        />
      </div>
      {dialogs}
    </article>
  )
})

/**
 * Card subtitle. "Ep 0 / ?" says nothing, so progress is only shown when some
 * was recorded or the title is being followed; otherwise year/format (or the
 * known size of a completed title). Display only — stored data is unchanged.
 */
function cardSubtitle(item: LibraryItem, progress: ReturnType<typeof primaryProgress>): string {
  const meta = [item.release_year, formatLabel(item.category, item.format)].filter(Boolean).join(' · ')
  if (!progress || progress.unit === '') return meta
  const following = item.status === 'in_progress' || item.status === 'on_hold' || !!item.active_session_id
  if (progress.value > 0 || following) return progress.label
  if (item.status === 'completed' && progress.total) {
    const unit = progress.unit === 'episodes' ? 'eps' : progress.unit === 'chapters' ? 'ch' : progress.unit
    return [`${progress.total} ${unit}`, item.release_year].filter(Boolean).join(' · ')
  }
  return meta
}

function QuickButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className="flex size-7 items-center justify-center rounded-md bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-accent [&_svg]:size-3.5"
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Measures a container and returns how many columns to use for the chosen
 * "per row" value: exactly that many, unless the screen is too narrow (then as
 * many as fit at MIN_CARD_PX, at least 2), plus the resulting card variant.
 */
export function usePosterColumns(perRow: number) {
  const [width, setWidth] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect()
    if (!el) return
    setWidth(el.clientWidth)
    ro.current = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.current.observe(el)
  }, [])
  const fit = width ? Math.max(2, Math.floor((width + 16) / (MIN_CARD_PX + 16))) : perRow
  const cols = Math.min(perRow, fit)
  const cardPx = width ? (width - (cols - 1) * 16) / cols : 160
  const variant: 'grid' | 'compact' = cardPx < COMPACT_BELOW ? 'compact' : 'grid'
  return { ref, cols, variant }
}

/** Poster grid with a fixed number of columns ("per row"). */
export function PosterGrid({ perRow, className, children }: {
  perRow: number; className?: string; children: (variant: 'grid' | 'compact') => React.ReactNode
}) {
  const { ref, cols, variant } = usePosterColumns(perRow)
  return (
    <div
      ref={ref}
      className={cn('grid', variant === 'compact' ? 'gap-x-3 gap-y-4' : 'gap-x-4 gap-y-6', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {children(variant)}
    </div>
  )
}
