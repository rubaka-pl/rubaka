import { Select as RSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

/** Compact select. Radix forbids empty-string values, so use e.g. "all" for "no filter". */
export function Select({ value, onValueChange, options, placeholder, className, 'aria-label': ariaLabel, id, disabled, size = 'md' }: {
  value: string | undefined
  onValueChange: (v: string) => void
  options: readonly SelectOption[]
  placeholder?: string
  className?: string
  'aria-label'?: string
  id?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 text-[13px] text-fg transition-colors hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 data-[placeholder]:text-fg-3 disabled:opacity-50',
          size === 'sm' ? 'h-7 text-xs' : 'h-8',
          className,
        )}
      >
        <span className="truncate"><RSelect.Value placeholder={placeholder} /></span>
        <RSelect.Icon><ChevronDown className="size-3.5 text-fg-3" /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),360px)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-surface shadow-card"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex h-7 cursor-pointer select-none items-center rounded px-2 pr-7 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg data-[state=checked]:text-fg"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2"><Check className="size-3.5 text-accent" /></RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}
