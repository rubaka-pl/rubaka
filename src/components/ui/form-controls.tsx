import { Checkbox as RCheckbox, Label as RLabel, Switch as RSwitch } from 'radix-ui'
import { Check, Minus } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'w-full rounded-md border border-line bg-surface-2 px-2.5 text-[13px] text-fg placeholder:text-fg-3 transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-8', className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Label = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<typeof RLabel.Root>>(({ className, ...props }, ref) => (
  <RLabel.Root ref={ref} className={cn('text-xs font-medium text-fg-2', className)} {...props} />
))
Label.displayName = 'Label'

export function Field({ label, htmlFor, hint, error, children, className }: {
  label: string; htmlFor?: string; hint?: string; error?: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  )
}

export const Checkbox = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RCheckbox.Root>>(({ className, ...props }, ref) => (
  <RCheckbox.Root
    ref={ref}
    className={cn(
      'peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent',
      className,
    )}
    {...props}
  >
    <RCheckbox.Indicator className="text-white">
      {props.checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
    </RCheckbox.Indicator>
  </RCheckbox.Root>
))
Checkbox.displayName = 'Checkbox'

export const Switch = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<typeof RSwitch.Root>>(({ className, ...props }, ref) => (
  <RSwitch.Root
    ref={ref}
    className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line bg-surface-hover transition-colors data-[state=checked]:bg-accent data-[state=checked]:border-accent', className)}
    {...props}
  >
    <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[17px]" />
  </RSwitch.Root>
))
Switch.displayName = 'Switch'

/** Number stepper input used for progress fields. */
export function NumberInput({ value, onChange, min = 0, max, className, id, 'aria-label': ariaLabel }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; max?: number | null
  className?: string; id?: string; 'aria-label'?: string
}) {
  return (
    <Input
      id={id}
      aria-label={ariaLabel}
      type="number"
      inputMode="numeric"
      min={min}
      max={max ?? undefined}
      value={value ?? ''}
      className={cn('w-20 tabular-nums', className)}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(null)
        const n = Math.trunc(Number(raw))
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}
