/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { Network, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Input } from '@/components/ui/form-controls'
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from '@/components/ui/overlays'
import type { Media } from '@/types/db'
import { useFranchiseList, useFranchiseMutations } from './api'
import { CreateFranchiseDialog } from './FranchisesPage'

/** Franchise chip on a title's page: link to the group, change it, or take the title out. */
export function FranchiseControl({ media }: { media: Media }) {
  const list = useFranchiseList()
  const m = useFranchiseMutations()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const current = list.data?.find((f) => f.id === media.franchise_id)
  const term = search.trim().toLowerCase()
  const options = (list.data ?? []).filter((f) => f.id !== media.franchise_id && (!term || f.name.toLowerCase().includes(term))).slice(0, 8)

  const pick = (id: string, name: string) => {
    m.setMember.mutate({ mediaId: media.id, franchiseId: id }, { onSuccess: () => toast.success(`Added to “${name}”`) })
    setOpen(false)
  }

  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors'
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {current && (
        <span className={`${chip} border-accent/40 bg-accent-soft text-fg`}>
          <Network className="size-3.5 text-accent-hover" />
          <Link to={`/franchises/${current.id}`} className="hover:underline">{current.name}</Link>
          <span className="text-fg-3">· {current.members}</span>
          <Tooltip content="Remove from franchise">
            <button className="-mr-1 rounded-full p-0.5 text-fg-3 hover:bg-surface-hover hover:text-fg" aria-label="Remove from franchise"
              onClick={() => m.setMember.mutate({ mediaId: media.id, franchiseId: null })}><X className="size-3" /></button>
          </Tooltip>
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className={`${chip} border-dashed border-line text-fg-3 hover:border-accent hover:text-fg`}>
            {current ? 'Change' : <><Plus className="size-3.5" /> Franchise</>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2">
          <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a franchise…" aria-label="Find a franchise" className="mb-1.5" />
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {options.map((f) => (
              <li key={f.id}>
                <button onClick={() => pick(f.id, f.name)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-hover">
                  <span className="truncate">{f.name}</span><span className="shrink-0 text-[11px] text-fg-3">{f.members}</span>
                </button>
              </li>
            ))}
            {!options.length && <li className="px-2 py-1.5 text-[12px] text-fg-3">{list.data?.length ? 'No match.' : 'No franchises yet.'}</li>}
          </ul>
          <button onClick={() => { setOpen(false); setCreateOpen(true) }} className="mt-1 flex w-full items-center gap-1.5 rounded border-t border-line px-2 pb-1 pt-2 text-left text-[13px] text-accent-hover hover:bg-surface-hover">
            <Plus className="size-3.5" /> New franchise{search.trim() ? ` “${search.trim()}”` : ''}
          </button>
        </PopoverContent>
      </Popover>
      {createOpen && <CreateFranchiseDialog open={createOpen} onOpenChange={setCreateOpen} mediaId={media.id} defaultName={search.trim() || media.title.split(/[:(]/)[0].trim()} />}
    </div>
  )
}
