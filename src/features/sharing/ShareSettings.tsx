/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { Copy, ExternalLink, Link2, RefreshCw, Share2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Switch } from '@/components/ui/form-controls'
import { Skeleton } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/overlays'
import { CATEGORY_LIST } from '@/lib/categories'
import type { MediaCategory } from '@/types/db'
import { shareUrl, useShareLink, useShareMutations } from './api'

/** Settings → Share: one secret link to a read-only copy of the library. */
export function ShareSettings() {
  const q = useShareLink()
  const m = useShareMutations()
  const [regenOpen, setRegenOpen] = useState(false)
  const link = q.data
  if (q.isLoading) return <Skeleton className="h-24" />

  if (!link) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[13px] text-fg-2">Anyone with the link sees your lists, favourites and ratings — never notes, reviews or history — and cannot change anything.</p>
        <Button variant="primary" onClick={() => m.create.mutate(undefined)} disabled={m.create.isPending}><Share2 /> Create share link</Button>
      </div>
    )
  }

  const url = shareUrl(link.token)
  const cats = link.categories
  const toggleCat = (c: MediaCategory, on: boolean) => {
    const cur = cats ?? CATEGORY_LIST.map((x) => x.id)
    const next = on ? Array.from(new Set([...cur, c])) : cur.filter((x) => x !== c)
    if (!next.length) return toast('Keep at least one category')
    m.update.mutate({ token: link.token, patch: { categories: next.length === CATEGORY_LIST.length ? null : next } })
  }
  const copy = () => navigator.clipboard.writeText(url).then(() => toast.success('Link copied'), () => toast.error('Copy failed — select the link and copy it'))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-accent-hover" />
          <Input readOnly value={url} onFocus={(e) => e.target.select()} className="pl-8 font-mono text-[12px]" aria-label="Share link" />
        </div>
        <Button variant="primary" onClick={() => void copy()}><Copy /> Copy</Button>
        <Button variant="secondary" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        <Switch checked={link.show_ratings} onCheckedChange={(v) => m.update.mutate({ token: link.token, patch: { show_ratings: v } })} />
        Show my ratings
      </label>

      <div>
        <div className="mb-1.5 text-[12px] text-fg-3">Categories visible on the link</div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {CATEGORY_LIST.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5 text-[13px]">
              <Checkbox checked={!cats || cats.includes(c.id)} onCheckedChange={(v) => toggleCat(c.id, v === true)} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setRegenOpen(true)}><RefreshCw /> New link</Button>
        <Button variant="ghost" size="sm" className="text-danger" onClick={() => m.disable.mutate()}>Turn off sharing</Button>
      </div>
      <p className="text-[11.5px] text-fg-3">Visitors see titles, covers, statuses, progress, favourites{link.show_ratings ? ' and ratings' : ''}. Notes, reviews, history, wishlist and time are never shared. Created {new Date(link.created_at).toLocaleDateString()}.</p>

      <ConfirmDialog open={regenOpen} onOpenChange={setRegenOpen} title="Make a new link?"
        description="The current link stops working right away; anyone you sent it to will need the new one."
        confirmLabel="New link" onConfirm={async () => { await m.create.mutateAsync({ show_ratings: link.show_ratings, categories: link.categories }) }} />
    </div>
  )
}
