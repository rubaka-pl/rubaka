import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Horizontal "swiper" row: native scrolling (wheel, trackpad, touch swipe)
 * plus arrow buttons and edge fades that appear only when there is more to see.
 */
export function ScrollRow({ children, className, innerRef, deps = [] }: {
  children: ReactNode
  className?: string
  /** Optional extra ref for the scrolling element (e.g. a ResizeObserver). */
  innerRef?: (el: HTMLDivElement | null) => void
  /** Re-check the arrows when these change (content updates). */
  deps?: unknown[]
}) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
  }, [])
  const setRef = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    innerRef?.(el)
    if (el) requestAnimationFrame(update)
  }, [innerRef, update])
  useEffect(() => {
    requestAnimationFrame(update)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [update, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.85, behavior: 'smooth' })
  const arrow = 'absolute top-[calc(50%-1.25rem)] z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface/95 text-fg shadow-card backdrop-blur transition hover:bg-accent hover:text-white'
  return (
    <div className="relative">
      <div ref={setRef} onScroll={update} role="list" className={cn('flex snap-x gap-3 overflow-x-auto scroll-smooth pb-2 scrollbar-none [&>*]:snap-start', className)}>
        {children}
      </div>
      {edges.left && <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-surface to-transparent" aria-hidden />}
      {edges.right && <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-surface to-transparent" aria-hidden />}
      {edges.left && <button type="button" className={cn(arrow, '-left-3')} onClick={() => page(-1)} aria-label="Scroll left"><ChevronLeft className="size-5" /></button>}
      {edges.right && <button type="button" className={cn(arrow, '-right-3')} onClick={() => page(1)} aria-label="Scroll right"><ChevronRight className="size-5" /></button>}
    </div>
  )
}
