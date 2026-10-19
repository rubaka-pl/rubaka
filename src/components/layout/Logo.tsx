import { cn } from '@/lib/utils'

export function Logo({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-extrabold tracking-[0.08em] text-accent-hover', className)}>
      <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-accent" />
        <path d="M10 8h7.5a5.5 5.5 0 0 1 1.6 10.76L23 24h-4.2l-3.4-5H14v5h-4V8Zm4 3.5V15.6h3.3a2.05 2.05 0 0 0 0-4.1H14Z" fill="#fff" />
      </svg>
      {!collapsed && <span className="text-[15px]">RUBAKA</span>}
    </span>
  )
}
