import { Check, Eye, LoaderCircle, Pencil } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/form-controls'
import { useUpdateEntry, type MediaDetail } from '@/features/tracking/api'

const Markdown = lazy(() => import('./Markdown'))

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

/** Markdown editor with debounced autosave and a visible save indicator. */
function NoteEditor({ label, initial, onSave, placeholder }: {
  label: string; initial: string; onSave: (v: string | null) => Promise<unknown>; placeholder: string
}) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<SaveState>('idle')
  const [preview, setPreview] = useState(false)
  const lastSaved = useRef(initial)

  useEffect(() => {
    if (value === lastSaved.current) return
    setState('dirty')
    const t = setTimeout(async () => {
      setState('saving')
      try {
        await onSave(value.trim() ? value : null)
        lastSaved.current = value
        setState('saved')
      } catch {
        setState('error')
      }
    }, 900)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Warn before leaving with unsaved text.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state === 'dirty' || state === 'saving') e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [state])

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{label}</h3>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-fg-3" aria-live="polite">
            {state === 'saving' && <><LoaderCircle className="size-3 animate-spin" /> Saving…</>}
            {state === 'saved' && <><Check className="size-3 text-success" /> Saved</>}
            {state === 'dirty' && 'Unsaved changes'}
            {state === 'error' && <span className="text-danger">Not saved — will retry on next edit</span>}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPreview(!preview)}>{preview ? <><Pencil /> Edit</> : <><Eye /> Preview</>}</Button>
        </div>
      </div>
      {preview ? (
        <div className="min-h-32 rounded-md border border-line bg-surface p-3">
          {value.trim() ? <Suspense fallback={<LoaderCircle className="size-4 animate-spin" />}><Markdown text={value} /></Suspense> : <p className="text-[13px] text-fg-3">Nothing written yet.</p>}
        </div>
      ) : (
        <Textarea aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} rows={8} placeholder={placeholder} className="font-[inherit]" />
      )}
      <p className="text-[11px] text-fg-3">Markdown supported: **bold**, _italic_, lists, links, &gt; quotes. Private — only you can see this.</p>
    </section>
  )
}

export function NotesTab({ d }: { d: MediaDetail }) {
  const update = useUpdateEntry()
  const e = d.entry
  if (!e) return null
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <NoteEditor label="Private notes" initial={e.notes ?? ''} placeholder="Thoughts, where you stopped, things to remember…"
        onSave={(notes) => update.mutateAsync({ entryId: e.id, mediaId: d.media.id, patch: { notes } })} />
      <NoteEditor label="Personal review" initial={e.review ?? ''} placeholder="Your review…"
        onSave={(review) => update.mutateAsync({ entryId: e.id, mediaId: d.media.id, patch: { review } })} />
    </div>
  )
}
