/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery } from '@tanstack/react-query'
import { Command } from 'cmdk'
import { Dialog as RDialog } from 'radix-ui'
import { ChartColumn, FileUp, LayoutDashboard, LoaderCircle, Plus, Search, Settings } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PosterImage } from '@/components/media/PosterImage'
import { StatusDot } from '@/components/media/PosterCard'
import { StarRating } from '@/components/ratings/StarRating'
import { fetchLibrary } from '@/features/tracking/api'
import { useDebounced } from '@/features/tracking/hooks'
import { CATEGORY_CONFIG, CATEGORY_LIST, statusLabel } from '@/lib/categories'
import { friendlyError, posterSrc } from '@/lib/supabase'

const itemCls = 'flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-[13px] text-fg-2 aria-selected:bg-surface-hover aria-selected:text-fg'

/**
 * Global library search. Matching happens in the database (library_query
 * with p_search): case/accent-insensitive across every stored title — English,
 * original, Japanese, romaji, Russian and synonyms — with trigram fuzzy
 * matching for typos.
 */
export function CommandPalette({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: () => void }) {
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 200)
  const navigate = useNavigate()
  const results = useQuery({
    queryKey: ['library', 'palette', term],
    queryFn: () => fetchLibrary({ search: term, sort: 'relevance', limit: 12 }),
    enabled: open && term.length > 0,
    placeholderData: (p) => p,
    staleTime: 10_000,
  })
  const go = (to: string) => {
    onOpenChange(false)
    setQ('')
    navigate(to)
  }

  return (
    <RDialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ('') }}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <RDialog.Title className="sr-only">Search library</RDialog.Title>
          <RDialog.Description className="sr-only">Search your library by any title, or jump to a page.</RDialog.Description>
          <Command shouldFilter={false} label="Search library" loop>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 text-fg-3" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search any title: English, 日本語, romaji, русский…" className="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3" />
              {results.isFetching && <LoaderCircle className="size-4 animate-spin text-fg-3" />}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
              {term && results.isError && <div className="px-3 py-6 text-center text-[13px] text-danger">{friendlyError(results.error)}</div>}
              {term && results.data && results.data.items.length === 0 && !results.isFetching && (
                <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">No titles in your library match “{term}”.</Command.Empty>
              )}
              {term && results.data && results.data.items.length > 0 && (
                <Command.Group heading="Library" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3">
                  {results.data.items.map((it) => {
                    const cfg = CATEGORY_CONFIG[it.category]
                    return (
                      <Command.Item key={it.entry_id} value={it.entry_id} onSelect={() => go(`/media/${it.media_id}`)} className={itemCls}>
                        <div className="w-8 shrink-0"><PosterImage src={posterSrc(it)} title="" category={it.category} className="rounded" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-fg">{it.title}</div>
                          <div className="flex items-center gap-1.5 truncate text-[11px] text-fg-3">
                            <cfg.icon className="size-3" /> {cfg.singular}
                            {it.release_year && <> · {it.release_year}</>}
                            <span aria-hidden>·</span> <StatusDot status={it.status} /> {statusLabel(it.status, it.category)}
                            {it.original_title && <> · <span className="truncate">{it.original_title}</span></>}
                          </div>
                        </div>
                        {it.rating != null && <StarRating value={it.rating} size="xs" />}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              )}
              {!term && (
                <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3">
                  <Command.Item value="add" onSelect={onAdd} className={itemCls}><Plus className="size-4" /> Add media <kbd className="ml-auto text-[10px] text-fg-3">N</kbd></Command.Item>
                  <Command.Item value="dashboard" onSelect={() => go('/')} className={itemCls}><LayoutDashboard className="size-4" /> Dashboard</Command.Item>
                  {CATEGORY_LIST.map((c) => (
                    <Command.Item key={c.id} value={c.id} onSelect={() => go(`/${c.slug}`)} className={itemCls}><c.icon className="size-4" /> {c.label}</Command.Item>
                  ))}
                  <Command.Item value="stats" onSelect={() => go('/stats')} className={itemCls}><ChartColumn className="size-4" /> Statistics</Command.Item>
                  <Command.Item value="import" onSelect={() => go('/import')} className={itemCls}><FileUp className="size-4" /> Import</Command.Item>
                  <Command.Item value="settings" onSelect={() => go('/settings')} className={itemCls}><Settings className="size-4" /> Settings</Command.Item>
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
