import { AlertDialog as RAlert, Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui'
import { X } from 'lucide-react'
import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

// ---------------------------------------------------------------- Dialog
export const Dialog = RDialog.Root
export const DialogTrigger = RDialog.Trigger
export const DialogClose = RDialog.Close

export function DialogContent({ title, description, children, className, wide, hideTitle }: {
  title: string; description?: string; children: ReactNode; className?: string; wide?: boolean | 'xl'; hideTitle?: boolean
}) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <RDialog.Content
        aria-describedby={description ? undefined : undefined}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[min(90dvh,900px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line bg-surface shadow-card focus:outline-none',
          wide === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg',
          className,
        )}
      >
        <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-3.5', hideTitle && 'sr-only')}>
          <div>
            <RDialog.Title className="text-[15px] font-semibold">{title}</RDialog.Title>
            {description ? <RDialog.Description className="mt-0.5 text-xs text-fg-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
          </div>
          <RDialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close"><X /></Button>
          </RDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </RDialog.Content>
    </RDialog.Portal>
  )
}

/** Left-side drawer (mobile navigation). */
export function Drawer({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RDialog.Content className="fixed inset-y-0 left-0 z-50 w-[260px] max-w-[85vw] border-r border-line bg-sidebar shadow-card focus:outline-none">
          <RDialog.Title className="sr-only">{title}</RDialog.Title>
          <RDialog.Description className="sr-only">{title}</RDialog.Description>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

// ---------------------------------------------------------------- Confirm
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm, children, confirmDisabled }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode
  confirmLabel?: string; destructive?: boolean; onConfirm: () => void | Promise<void>; children?: ReactNode; confirmDisabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  return (
    <RAlert.Root open={open} onOpenChange={onOpenChange}>
      <RAlert.Portal>
        <RAlert.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RAlert.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-24px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface p-5 shadow-card">
          <RAlert.Title className="text-[15px] font-semibold">{title}</RAlert.Title>
          <RAlert.Description asChild>
            <div className="mt-2 text-[13px] leading-relaxed text-fg-2">{description}</div>
          </RAlert.Description>
          {children}
          <div className="mt-5 flex justify-end gap-2">
            <RAlert.Cancel asChild><Button variant="ghost">Cancel</Button></RAlert.Cancel>
            <Button
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              disabled={confirmDisabled}
              onClick={async () => {
                setBusy(true)
                try {
                  await onConfirm()
                  onOpenChange(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </RAlert.Content>
      </RAlert.Portal>
    </RAlert.Root>
  )
}

// ---------------------------------------------------------------- Dropdown
export const Menu = RMenu.Root
export const MenuTrigger = RMenu.Trigger

export function MenuContent({ children, align = 'end', className }: { children: ReactNode; align?: 'start' | 'end' | 'center'; className?: string }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} sideOffset={4} className={cn('z-50 min-w-44 rounded-md border border-line bg-surface p-1 shadow-card', className)}>
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  )
}

export function MenuItem({ className, destructive, ...props }: ComponentPropsWithoutRef<typeof RMenu.Item> & { destructive?: boolean }) {
  return (
    <RMenu.Item
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg data-[disabled]:opacity-50 [&_svg]:size-4',
        destructive && 'text-danger data-[highlighted]:text-danger',
        className,
      )}
      {...props}
    />
  )
}

export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-line" />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <RMenu.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-3">{children}</RMenu.Label>
)
export const MenuSub = RMenu.Sub
export function MenuSubTrigger({ children }: { children: ReactNode }) {
  return (
    <RMenu.SubTrigger className="flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-surface-hover data-[state=open]:bg-surface-hover [&_svg]:size-4">
      {children}
    </RMenu.SubTrigger>
  )
}
export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <RMenu.Portal>
      <RMenu.SubContent sideOffset={4} className="z-50 min-w-40 rounded-md border border-line bg-surface p-1 shadow-card">{children}</RMenu.SubContent>
    </RMenu.Portal>
  )
}

// ---------------------------------------------------------------- Popover
export const Popover = RPopover.Root
export const PopoverTrigger = RPopover.Trigger
export function PopoverContent({ children, className, align = 'start' }: { children: ReactNode; className?: string; align?: 'start' | 'end' | 'center' }) {
  return (
    <RPopover.Portal>
      <RPopover.Content align={align} sideOffset={6} className={cn('z-50 rounded-md border border-line bg-surface p-3 shadow-card focus:outline-none', className)}>
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  )
}

// ---------------------------------------------------------------- Tooltip
export const TooltipProvider = RTooltip.Provider
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 rounded bg-fg px-2 py-1 text-xs font-medium text-bg shadow">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}
