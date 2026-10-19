import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/misc'
import type { MediaDetail } from '@/features/tracking/api'
import { CATEGORY_CONFIG, COUNTRY_LABEL, formatLabel, RELEASE_STATUS_LABEL } from '@/lib/categories'
import { formatDate, formatTimestamp } from '@/lib/dates'
import type { MediaDetails } from '@/types/db'

const TITLE_KIND_LABEL: Record<string, string> = {
  english: 'English', romaji: 'Romaji', japanese: 'Japanese', native: 'Native', russian: 'Russian', synonym: 'Also known as', other: 'Other',
}

export function Overview({ d }: { d: MediaDetail }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        {d.media.synopsis ? (
          <p className="max-w-3xl whitespace-pre-line text-[14px] leading-relaxed text-fg-2">{d.media.synopsis}</p>
        ) : (
          <p className="text-[13px] text-fg-3">
            No synopsis yet.{' '}
            {d.media.enrichment_state === 'unresolved' ? 'No matching metadata was found — use Edit to add it manually.' : 'Use “Fill missing metadata” in the ⋯ menu or Edit to add one.'}
          </p>
        )}
        {d.titles.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">Alternative titles</h3>
            <ul className="flex flex-col gap-0.5 text-[13px]">
              {d.titles.map((t) => <li key={t.id}><span className="text-fg-3">{TITLE_KIND_LABEL[t.kind] ?? t.kind}:</span> <span className="text-fg-2">{t.title}</span></li>)}
            </ul>
          </div>
        )}
        {Array.isArray(d.media.details?.themes) && (d.media.details.themes as string[]).length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-3">Themes</h3>
            <div className="flex flex-wrap gap-1.5">{(d.media.details.themes as string[]).map((t) => <Badge key={t}>{t}</Badge>)}</div>
          </div>
        )}
      </div>
      <aside className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-2 text-[13px] font-semibold">Details</h3>
        <DetailsList d={d} />
      </aside>
    </div>
  )
}

const DETAIL_LABEL: Partial<Record<keyof MediaDetails | string, string>> = {
  studios: 'Studios', authors: 'Authors', artists: 'Artists', developers: 'Developers', publishers: 'Publishers',
  directors: 'Directors', creators: 'Creators', cast: 'Cast', platforms: 'Platforms', networks: 'Networks',
  source: 'Source', age_rating: 'Age rating', language: 'Language', tags: 'Tags',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1 text-[13px]">
      <dt className="text-fg-3">{label}</dt>
      <dd className="min-w-0 break-words text-fg-2">{children}</dd>
    </div>
  )
}

/** Category-specific metadata. `full` adds identifiers and enrichment state. */
export function DetailsList({ d, full }: { d: MediaDetail; full?: boolean }) {
  const m = d.media
  const cfg = CATEGORY_CONFIG[m.category]
  const details = m.details ?? {}
  const japanese = d.titles.find((t) => t.kind === 'japanese' || t.kind === 'native')?.title
  return (
    <dl className={full ? 'max-w-2xl rounded-lg border border-line bg-surface p-4' : ''}>
      {m.original_title && <Row label="Original">{m.original_title}</Row>}
      {japanese && japanese !== m.original_title && <Row label="Native">{japanese}</Row>}
      {m.format && <Row label="Format">{formatLabel(m.category, m.format)}</Row>}
      {cfg.progress === 'episodes' && <Row label="Episodes">{m.total_episodes ?? 'Unknown'}</Row>}
      {cfg.seasons && <Row label="Seasons">{m.total_seasons ?? 'Unknown'}</Row>}
      {cfg.progress === 'chapters' && <Row label="Chapters">{m.total_chapters ?? 'Unknown'}</Row>}
      {cfg.volumes && <Row label="Volumes">{m.total_volumes ?? 'Unknown'}</Row>}
      {cfg.progress === 'routes' && <Row label="Routes">{m.total_routes ?? 'Unknown'}</Row>}
      {m.episode_duration && <Row label="Ep. duration">{m.episode_duration} min</Row>}
      {m.runtime && <Row label="Runtime">{m.runtime} min</Row>}
      {m.release_status && <Row label="Status">{RELEASE_STATUS_LABEL[m.release_status]}</Row>}
      {(m.release_date || m.release_year) && (
        <Row label={cfg.progress === 'chapters' ? 'Published' : 'Released'}>
          {m.release_date ? formatDate(m.release_date) : m.release_year}{m.end_date ? ` – ${formatDate(m.end_date)}` : ''}
        </Row>
      )}
      {m.country && <Row label="Country">{COUNTRY_LABEL[m.country] ?? m.country}</Row>}
      {Object.entries(DETAIL_LABEL).map(([k, label]) => {
        const v = details[k]
        if (v == null || (Array.isArray(v) && !v.length)) return null
        return <Row key={k} label={label!}>{Array.isArray(v) ? (v as string[]).join(', ') : String(v)}</Row>
      })}
      {d.genres.length > 0 && (
        <Row label="Genres">
          {d.genres.map((g, i) => <span key={g}>{i > 0 && ', '}<Link className="text-accent-hover hover:underline" to={`/${cfg.slug}?genres=${encodeURIComponent(g)}`}>{g}</Link></span>)}
        </Row>
      )}
      {typeof details.imdb_rating === 'number' && <Row label="IMDb rating">{details.imdb_rating}</Row>}
      {full && (
        <>
          {d.externalIds.map((x) => (
            <Row key={x.provider} label={x.provider}>
              {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="text-accent-hover hover:underline">{x.external_id}</a> : x.external_id}
            </Row>
          ))}
          <Row label="Metadata">{m.is_custom ? 'Custom entry' : m.enrichment_state}{m.enriched_at ? ` · ${formatTimestamp(m.enriched_at)}` : ''}</Row>
          {m.locked_fields.length > 0 && <Row label="Edited by hand">{m.locked_fields.join(', ')}</Row>}
          {d.entry && <Row label="Added">{formatTimestamp(d.entry.added_at)}</Row>}
        </>
      )}
    </dl>
  )
}
