/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { RATING_MAX, starsText } from '@/lib/rating'
import { cn } from '@/lib/utils'

const STAR_PATH =
  'M12 2.6l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.03l-5.66 2.98 1.08-6.3L2.84 9.25l6.33-.92L12 2.6z'

/** One star; `fill` is 0, 0.5 or 1. Half fill is drawn with a clip, not a font glyph. */
function Star({ fill, size, clipId }: { fill: number; size: number; clipId: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={24 * fill} height="24" />
        </clipPath>
      </defs>
      <path d={STAR_PATH} className="fill-rating-empty" />
      {fill > 0 && <path d={STAR_PATH} className="fill-rating" clipPath={`url(#${clipId})`} />}
    </svg>
  )
}

const SIZES = { xs: 11, sm: 14, md: 18, lg: 24 } as const

export interface StarRatingProps {
  /** Half-stars 0..10, or null for unrated. */
  value: number | null
  onChange?: (v: number | null) => void
  size?: keyof typeof SIZES
  /** Show buttons to set an explicit 0 and to clear. */
  showControls?: boolean
  showValue?: boolean
  className?: string
  label?: string
  disabled?: boolean
}

export function StarRating({ value, onChange, size = 'md', showControls, showValue, className, label = 'Rating', disabled }: StarRatingProps) {
  const readOnly = !onChange || disabled
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const px = SIZES[size]
  const shown = hover ?? value ?? 0

  // Map a pointer x position to half-stars: the left half of a star is .5,
  // the right half is a full star. Minimum through the pointer is 0.5;
  // an explicit 0 is set with the "0" button or the Home key.
  const valueAt = (clientX: number) => {
    const el = ref.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    return Math.min(RATING_MAX, Math.max(1, Math.ceil(ratio * RATING_MAX)))
  }

  const onPointerDown = (e: PointerEvent) => {
    if (readOnly) return
    dragging.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    setHover(valueAt(e.clientX))
  }
  const onPointerMove = (e: PointerEvent) => {
    if (readOnly) return
    if (e.pointerType === 'mouse' || dragging.current) setHover(valueAt(e.clientX))
  }
  const onPointerUp = (e: PointerEvent) => {
    if (readOnly || !dragging.current) return
    dragging.current = false
    const v = valueAt(e.clientX)
    if (e.pointerType !== 'mouse') setHover(null)
    if (v != null && v !== value) onChange!(v)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (readOnly) return
    let next: number | null | undefined
    const cur = value ?? 0
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': next = Math.min(RATING_MAX, value == null ? 1 : cur + 1); break
      case 'ArrowLeft': case 'ArrowDown': next = Math.max(0, cur - 1); break
      case 'Home': next = 0; break
      case 'End': next = RATING_MAX; break
      case 'Delete': case 'Backspace': next = null; break
      default:
        if (/^[0-5]$/.test(e.key)) next = Number(e.key) * 2
    }
    if (next !== undefined) {
      e.preventDefault()
      if (next !== value) onChange!(next)
    }
  }

  const valueText = value == null ? 'Unrated' : `${starsText(value)} of 5 stars`

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div
        ref={ref}
        role={readOnly ? 'img' : 'slider'}
        aria-label={readOnly ? `${label}: ${valueText}` : label}
        aria-valuemin={readOnly ? undefined : 0}
        aria-valuemax={readOnly ? undefined : 5}
        aria-valuenow={readOnly ? undefined : value == null ? undefined : value / 2}
        aria-valuetext={readOnly ? undefined : valueText}
        tabIndex={readOnly ? undefined : 0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragging.current = false; setHover(null) }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null) }}
        className={cn(
          'flex items-center rounded-sm',
          !readOnly && 'cursor-pointer touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-4',
          size === 'xs' ? 'gap-px' : 'gap-0.5',
        )}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.min(1, Math.max(0, (shown - i * 2) / 2))
          return (
            <span key={i} className={cn('transition-transform duration-100', hover != null && !readOnly && 'scale-105')}>
              <Star fill={fill} size={px} clipId={`${uid}-s${i}`} />
            </span>
          )
        })}
      </div>
      {showValue && (
        <span className={cn('tabular-nums text-fg-2', size === 'lg' ? 'text-sm' : 'text-xs')}>
          {hover != null ? `${starsText(hover)} / 5` : value == null ? 'Unrated' : `${starsText(value)} / 5`}
        </span>
      )}
      {showControls && !readOnly && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange!(0)}
            aria-pressed={value === 0}
            className={cn(
              'h-6 rounded px-1.5 text-[11px] font-medium transition-colors',
              value === 0 ? 'bg-accent-soft text-fg ring-1 ring-accent/50' : 'text-fg-3 hover:bg-surface-hover hover:text-fg',
            )}
            title="Set an explicit 0-star rating"
          >
            0★
          </button>
          {value != null && (
            <button
              type="button"
              onClick={() => onChange!(null)}
              className="inline-flex size-6 items-center justify-center rounded text-fg-3 hover:bg-surface-hover hover:text-fg"
              aria-label="Clear rating"
              title="Clear rating"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
