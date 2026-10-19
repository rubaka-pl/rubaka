import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { PosterImage } from '@/components/media/PosterImage'
import { Badge, EmptyState } from '@/components/ui/misc'
import type { MediaDetail } from '@/features/tracking/api'
import { CATEGORY_CONFIG } from '@/lib/categories'
import type { RelationType } from '@/types/db'

const LABEL: Record<RelationType, string> = {
  adaptation: 'Adaptation', source: 'Source material', sequel: 'Sequel', prequel: 'Prequel', side_story: 'Side story',
  spin_off: 'Spin-off', alternative: 'Alternative version', parent: 'Parent story', summary: 'Summary', character: 'Shares characters', other: 'Related',
}
const ORDER: RelationType[] = ['source', 'adaptation', 'prequel', 'sequel', 'parent', 'side_story', 'spin_off', 'alternative', 'summary', 'character', 'other']

function externalUrl(provider: string | null, id: string | null, category: string | null): string | null {
  if (!provider || !id) return null
  if (provider === 'anilist') return `https://anilist.co/${category === 'anime' ? 'anime' : 'manga'}/${id}`
  if (provider === 'vndb') return `https://vndb.org/${id}`
  return null
}

/** Relations from providers. Titles already in the library link locally; others link out. Nothing is merged. */
export function RelationsTab({ d }: { d: MediaDetail }) {
  if (!d.relations.length) {
    return <EmptyState title="No known relations" description="Related works appear here when a metadata provider supplies reliable relationship data (AniList, VNDB)." className="py-8" />
  }
  const sorted = [...d.relations].sort((a, b) => ORDER.indexOf(a.relation_type) - ORDER.indexOf(b.relation_type))
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2.5">
      {sorted.map((r) => {
        const local = !!r.related_media_id
        const inner = (
          <div className="flex gap-3 rounded-lg border border-line bg-surface p-2 transition-colors hover:border-line-strong">
            <div className="w-12 shrink-0"><PosterImage src={r.related_poster_url} title={r.related_title ?? ''} category={r.related_category ?? undefined} className="rounded" /></div>
            <div className="min-w-0">
              <Badge tone={local ? 'accent' : 'default'}>{LABEL[r.relation_type]}</Badge>
              <div className="mt-1 line-clamp-2 text-[13px] font-medium">{r.related_title}</div>
              <div className="flex items-center gap-1 text-[11px] text-fg-3">
                {r.related_category && CATEGORY_CONFIG[r.related_category].singular}
                {local ? ' · In your library' : <> · Not in library {r.related_provider && <ExternalLink className="size-3" />}</>}
              </div>
            </div>
          </div>
        )
        if (local) return <Link key={r.id} to={`/media/${r.related_media_id}`}>{inner}</Link>
        const href = externalUrl(r.related_provider, r.related_external_id, r.related_category)
        return href ? <a key={r.id} href={href} target="_blank" rel="noreferrer">{inner}</a> : <div key={r.id}>{inner}</div>
      })}
    </div>
  )
}
