/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { Link } from 'react-router'
import { PosterImage } from '@/components/media/PosterImage'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc'
import { fetchLibrary } from '@/features/tracking/api'
import { providerJson } from '@/integrations/http'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { posterSrc, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { LibraryItem } from '@/types/db'

interface Airing { item: LibraryItem; at: Date; episode: number | null; season?: number | null }

const DAY = 86_400_000

/**
 * Episodes of airing titles you follow (watching, planning, on hold or
 * completed so far) for the next 7 days: anime from AniList's airing schedule,
 * TV / animated series from TVMaze. Times are shown in your local time zone.
 */
export async function fetchAiring(): Promise<Airing[]> {
  const { items } = await fetchLibrary({ releaseStatuses: ['releasing'], statuses: ['in_progress', 'planning', 'on_hold', 'completed'], sort: 'activity_desc', limit: 300 })
  const shows = items.filter((i) => i.category === 'anime' || i.category === 'tv_series' || i.category === 'animated_series')
  if (!shows.length) return []
  const ids = (await supabase.from('media_external_ids').select('media_id, provider, external_id')
    .in('media_id', shows.map((s) => s.media_id)).in('provider', ['anilist', 'tvmaze'])).data ?? []
  const byMedia = new Map(shows.map((s) => [s.media_id, s]))
  const now = Date.now()
  const out: Airing[] = []

  // Anime: AniList airing schedule, 50 ids per request.
  const anilist = ids.filter((x) => x.provider === 'anilist')
  for (let i = 0; i < anilist.length; i += 50) {
    const part = anilist.slice(i, i + 50)
    const res = await providerJson<{ data: { Page: { airingSchedules: { airingAt: number; episode: number; mediaId: number }[] } } }>('anilist', 'https://graphql.anilist.co', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: 'query ($ids: [Int], $from: Int, $to: Int) { Page(perPage: 100) { airingSchedules(mediaId_in: $ids, airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { airingAt episode mediaId } } }',
        variables: { ids: part.map((x) => Number(x.external_id)), from: Math.floor((now - DAY / 2) / 1000), to: Math.floor((now + 7 * DAY) / 1000) },
      }),
    })
    const media = new Map(part.map((x) => [Number(x.external_id), x.media_id]))
    for (const s of res.data.Page.airingSchedules) {
      const item = byMedia.get(media.get(s.mediaId) ?? '')
      if (item) out.push({ item, at: new Date(s.airingAt * 1000), episode: s.episode })
    }
  }

  // Series: TVMaze's next episode for each show.
  const tvmaze = ids.filter((x) => x.provider === 'tvmaze')
  await Promise.all(tvmaze.map(async (x) => {
    try {
      const show = await providerJson<{ _embedded?: { nextepisode?: { airstamp: string | null; number: number | null; season: number } } }>(
        'tvmaze', `https://api.tvmaze.com/shows/${Number(x.external_id)}?embed=nextepisode`)
      const ep = show._embedded?.nextepisode
      const item = byMedia.get(x.media_id)
      if (ep?.airstamp && item) {
        const at = new Date(ep.airstamp)
        if (at.getTime() < now + 7 * DAY) out.push({ item, at, episode: ep.number, season: ep.season })
      }
    } catch { /* one show failing does not hide the others */ }
  }))
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

export function AiringCalendar() {
  const q = useQuery({ queryKey: ['library', 'airing'], queryFn: fetchAiring, staleTime: 30 * 60_000 })
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isLoading) return <div className="grid grid-cols-7 gap-2">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
  const list = q.data ?? []
  if (!list.length) {
    return <EmptyState icon={<CalendarDays />} title="Nothing airing this week" description="Episodes of ongoing anime and series you follow (watching, planned, on hold) show up here." className="py-8" />
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * DAY))
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  const byDay = new Map<string, Airing[]>()
  for (const a of list) {
    const d = new Date(a.at); d.setHours(0, 0, 0, 0)
    const k = d < today ? key(today) : key(d) // aired in the last hours → today
    byDay.set(k, [...(byDay.get(k) ?? []), a])
  }

  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 scrollbar-none md:grid md:grid-cols-7 md:overflow-visible">
      {days.map((d, i) => {
        const items = byDay.get(key(d)) ?? []
        return (
          <div key={i} className={cn('flex min-h-32 w-40 shrink-0 snap-start flex-col gap-1.5 rounded-lg border bg-surface p-2 md:w-auto',
            i === 0 ? 'border-accent/60 ring-1 ring-accent/30' : 'border-line')}>
            <div className="flex items-baseline justify-between px-0.5">
              <span className={cn('text-[12px] font-semibold', i === 0 ? 'text-accent-hover' : 'text-fg-2')}>
                {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              <span className="text-[10.5px] text-fg-3 tabular-nums">{d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            </div>
            {items.length === 0 && <span className="px-0.5 text-[11px] text-fg-3/70">—</span>}
            {items.map((a) => {
              const aired = a.at.getTime() <= Date.now()
              const cfg = CATEGORY_CONFIG[a.item.category]
              return (
                <Link key={`${a.item.entry_id}-${a.episode}`} to={`/media/${a.item.media_id}`} title={a.item.title}
                  className={cn('group flex gap-1.5 rounded-md p-1 transition-colors hover:bg-surface-hover', aired && 'opacity-60')}>
                  <div className="w-8 shrink-0"><PosterImage src={posterSrc(a.item)} title={a.item.title} category={a.item.category} className="rounded" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[11.5px] font-medium leading-tight group-hover:text-accent-hover">{a.item.title}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-fg-3 tabular-nums">
                      <cfg.icon className="size-3 shrink-0" />
                      {a.at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      {a.episode != null && <span>· {a.season ? `S${a.season}E${a.episode}` : `Ep ${a.episode}`}</span>}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
