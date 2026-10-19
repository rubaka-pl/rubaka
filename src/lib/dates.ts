// Date helpers. Plain dates (start/completion: YYYY-MM-DD) are never shifted
// by timezone; timestamps are displayed in the user's selected timezone.
import { getSettingsSnapshot } from '@/features/settings/settings-store'

export function todayISO(tz = getSettingsSnapshot().timezone): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric' },
}

/** Format a plain date (YYYY-MM-DD) without timezone conversion. */
export function formatDate(s: string | null | undefined, style = getSettingsSnapshot().dateFormat): string {
  if (!s) return '—'
  if (style === 'iso') return s.slice(0, 10)
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return s
  return new Intl.DateTimeFormat('en-GB', { ...(FORMATS[style] ?? FORMATS.medium), timeZone: 'UTC' }).format(d)
}

function safeTz(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** Format a timestamp in the user's timezone. */
export function formatTimestamp(s: string | null | undefined, withTime = false): string {
  if (!s) return '—'
  const { timezone, dateFormat } = getSettingsSnapshot()
  const timeZone = safeTz(timezone)
  if (dateFormat === 'iso' && !withTime) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s))
  }
  return new Intl.DateTimeFormat('en-GB', {
    ...(FORMATS[dateFormat] ?? FORMATS.medium),
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone,
  }).format(new Date(s))
}

export function timeAgo(s: string): string {
  const diff = (Date.now() - new Date(s).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (diff < 60) return 'just now'
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour')
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day')
  return formatTimestamp(s)
}

export const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC', 'Europe/Moscow', 'Europe/Warsaw', 'Europe/London', 'America/New_York', 'Asia/Tokyo']
  }
})()
