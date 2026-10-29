/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
// One gallery by link or id, fetched through the `metadata-proxy`
// Edge Function (the source sends no CORS headers) and normalised with the same
// adapter the favourites import uses, so both paths produce identical entries.
import { parseGallery } from '@/features/imports/adapters/gallery'
import type { NormalizedRecord } from '@/features/imports/types'
import { invoke } from './proxied'
import { ProviderError } from './types'

/** Gallery id from "https://nhentai.net/g/123/", "nhentai.net/g/123/5/" or "123"; null if none. */
export function galleryIdFromInput(input: string): string | null {
  const t = input.trim()
  return t.match(/^(\d{1,9})$/)?.[1] ?? t.match(/nhentai\.net\/g\/(\d{1,9})/i)?.[1] ?? null
}

export async function getGalleryRecord(id: string): Promise<NormalizedRecord> {
  const g = await invoke<Record<string, unknown> & { cover?: { path?: string } }>('nhentai', { path: `/galleries/${id}` })
  const cover = g.cover?.path
  const thumb = cover ? `https://t.nhentai.net/${cover.replace(/\.webp\.webp$/, '.webp')}` : null
  const { records, invalid } = parseGallery(JSON.stringify([{ ...g, thumb }]))
  if (!records[0]) throw new ProviderError(invalid[0]?.reason ?? 'Could not read this gallery', 'nhentai')
  return records[0]
}
