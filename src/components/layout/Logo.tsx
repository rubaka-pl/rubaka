import { cn } from '@/lib/utils'

/** RUBAKA wordmark (cut from the owner's artwork, transparent PNG); the square mark when the sidebar is collapsed. */
export function Logo({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  if (!collapsed) {
    return (
      <span className={cn('inline-flex items-center', className)}>
        <img src={`${import.meta.env.BASE_URL}rubaka-logo.png`} alt="RUBAKA" width={500} height={118}
          className="h-9 w-auto select-none drop-shadow-[0_0_10px_rgb(139_108_240/0.35)] [[data-theme=light]_&]:invert" draggable={false} />
      </span>
    )
  }
  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-accent" />
        <path d="M10 8h7.5a5.5 5.5 0 0 1 1.6 10.76L23 24h-4.2l-3.4-5H14v5h-4V8Zm4 3.5V15.6h3.3a2.05 2.05 0 0 0 0-4.1H14Z" fill="#fff" />
      </svg>
    </span>
  )
}
