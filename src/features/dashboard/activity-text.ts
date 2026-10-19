import { CATEGORY_CONFIG, statusLabel } from '@/lib/categories'
import { starsText } from '@/lib/rating'
import type { ActivityRow, LibraryStatus } from '@/types/db'

const SOURCE_LABEL: Record<string, string> = {
  mal_xml: 'MyAnimeList', imdb_csv: 'IMDb', backloggd_json: 'Backloggd', vndb_api: 'VNDB', rubaka_backup: 'a RUBAKA backup',
}

/** Human-readable sentence for an activity row (without the title). */
export function activityText(a: ActivityRow): string {
  const cfg = a.category ? CATEGORY_CONFIG[a.category] : undefined
  const d = a.details as Record<string, unknown>
  switch (a.action) {
    case 'added': return d.wishlist ? 'Added to wishlist' : 'Added'
    case 'completed': return cfg?.id === 'movie' ? 'Watched' : 'Completed'
    case 'status_changed': return `Marked as ${statusLabel(d.to as LibraryStatus, a.category ?? undefined)}`
    case 'rating_changed': return d.to == null ? 'Cleared rating' : `Rated ${starsText(d.to as number)}★`
    case 'progress': {
      const from = (d.from ?? {}) as Record<string, number>
      const to = (d.to ?? {}) as Record<string, number>
      for (const [k, verb, unit] of [
        ['episodes', 'Watched', 'episode'], ['chapters', 'Read', 'chapter'], ['volumes', 'Read', 'volume'], ['routes', 'Completed', 'route'],
      ] as const) {
        if ((to[k] ?? 0) !== (from[k] ?? 0)) {
          const delta = (to[k] ?? 0) - (from[k] ?? 0)
          if (delta === 1) return `${verb} ${unit} ${to[k]}`
          if (delta > 1) return `${verb} ${delta} ${unit}s`
          return `Progress set to ${unit} ${to[k] ?? 0}`
        }
      }
      return 'Updated progress'
    }
    case 'repeat_started': return `Started a ${cfg?.repeatLabel.toLowerCase() ?? 'repeat'}`
    case 'repeat_completed': return `Finished a ${cfg?.repeatLabel.toLowerCase() ?? 'repeat'}`
    case 'repeat_abandoned': return `Stopped a ${cfg?.repeatLabel.toLowerCase() ?? 'repeat'}`
    case 'wishlist_added': return 'Added to wishlist'
    case 'wishlist_removed': return 'Removed from wishlist'
    case 'favorited': return 'Marked as favorite'
    case 'imported': {
      const o = (d.outcomes ?? {}) as Record<string, number>
      return `Imported from ${SOURCE_LABEL[d.source as string] ?? 'a file'}: ${o.created ?? 0} new, ${o.updated ?? 0} updated`
    }
    case 'restored': return 'Restored a backup'
  }
}
