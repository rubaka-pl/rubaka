/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { invalidateLibrary, useUpdateMedia } from '@/features/tracking/api'
import { removeImage, uploadImage } from '@/lib/assets'
import { friendlyError } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Media } from '@/types/db'

const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

/**
 * Quick manual cover replacement on the detail page: drop an image file or an
 * image dragged from another tab, paste (Ctrl+V) an image or an image link,
 * or pick a file. Files are uploaded to Supabase Storage; links are stored as
 * the poster URL. Either way the field is locked against enrichment.
 */
export function CoverDrop({ media, children }: { media: Media; children: ReactNode }) {
  const qc = useQueryClient()
  const updateMedia = useUpdateMedia()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef(media)
  useEffect(() => { mediaRef.current = media }, [media])

  const apply = async (input: { file?: File; url?: string }) => {
    const m = mediaRef.current
    setBusy(true)
    try {
      if (input.file) {
        const path = await uploadImage(input.file, 'poster')
        await updateMedia.mutateAsync({ mediaId: m.id, patch: { custom_poster_path: path } })
        if (m.custom_poster_path) void removeImage(m.custom_poster_path)
      } else if (input.url) {
        // A link replaces any uploaded cover (custom uploads would otherwise win).
        await updateMedia.mutateAsync({ mediaId: m.id, patch: { poster_url: input.url.trim(), custom_poster_path: null } })
        if (m.custom_poster_path) void removeImage(m.custom_poster_path)
      }
      invalidateLibrary(qc, m.id)
      toast.success('Cover updated')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  const applyRef = useRef(apply)
  useEffect(() => { applyRef.current = apply })

  // Ctrl+V anywhere on the page (except while typing in a field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t.isContentEditable || ['INPUT', 'TEXTAREA'].includes(t.tagName)) return
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (file) { e.preventDefault(); void applyRef.current({ file }) }
      else if (isHttpUrl(text)) { e.preventDefault(); void applyRef.current({ url: text }) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div
      className="group/cover relative"
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
        if (file) return void apply({ file })
        const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0]
        if (isHttpUrl(url)) return void apply({ url })
        toast.error('Drop an image file or an image from another tab')
      }}
    >
      {children}
      <div className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed transition-opacity',
        over ? 'border-accent bg-accent/25 opacity-100' : 'border-transparent opacity-0',
      )}>
        <span className="rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">Drop to set cover</span>
      </div>
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50" role="status" aria-label="Uploading cover">
          <LoaderCircle className="size-6 animate-spin text-white" />
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1.5 rounded-md bg-black/70 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover/cover:opacity-100 [@media(hover:none)]:opacity-100"
        title="Or drag an image here, or press Ctrl+V with an image / image link copied"
      >
        <ImagePlus className="size-3.5" /> Change cover
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void apply({ file: f }); e.target.value = '' }} />
    </div>
  )
}
