// Ratings are stored as integer half-stars (0..10) to avoid floating point
// comparisons in the database. null = unrated, 0 = an explicit zero rating.

export const RATING_MAX = 10

export function formatRating(v: number | null | undefined): string {
  if (v == null) return 'Unrated'
  const s = v / 2
  return `${Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)} / 5`
}

export function starsText(v: number | null | undefined): string {
  if (v == null) return '—'
  const s = v / 2
  return Number.isInteger(s) ? s.toFixed(0) : s.toFixed(1)
}

export function isValidHalfStars(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= RATING_MAX
}

/**
 * Convert a 1..10 integer score (MyAnimeList, IMDb, Backloggd) to half-stars.
 * The scales line up exactly (10 = 5 stars, 7 = 3.5 stars). Sources use 0 or
 * an empty value for "not scored", which maps to null — never to 0 stars.
 */
export function tenPointToHalfStars(score: number | string | null | undefined): number | null {
  if (score == null || score === '') return null
  const n = typeof score === 'number' ? score : Number(score)
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return Math.round(n)
}
