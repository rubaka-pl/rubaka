/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import type { LibraryItem, LibraryStatus, MediaCategory, ShareLink } from '@/types/db'

/** Public address of a share link (works on GitHub Pages and locally). */
export function shareUrl(token: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}/u/${token}`
}

export function useShareLink() {
  return useQuery({
    queryKey: ['share-link'],
    queryFn: async () => unwrap(await supabase.from('share_links').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(), 'share link') as ShareLink | null,
  })
}

export function useShareMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['share-link'] })
  const onError = (e: unknown) => toast.error(friendlyError(e))
  /** New random link; any previous link stops working immediately. */
  const create = useMutation({
    mutationFn: async (keep?: Pick<ShareLink, 'show_ratings' | 'categories'>) => {
      unwrap(await supabase.from('share_links').delete().not('token', 'is', null), 'remove old link')
      return unwrap(await supabase.from('share_links').insert(keep ?? { show_ratings: true, categories: null }).select().single(), 'create link') as ShareLink
    },
    onError, onSettled: done,
  })
  const update = useMutation({
    mutationFn: async ({ token, patch }: { token: string; patch: Partial<Pick<ShareLink, 'show_ratings' | 'categories'>> }) => {
      unwrap(await supabase.from('share_links').update(patch).eq('token', token), 'update link')
    },
    onError, onSettled: done,
  })
  const disable = useMutation({
    mutationFn: async () => {
      unwrap(await supabase.from('share_links').delete().not('token', 'is', null), 'disable link')
    },
    onError, onSettled: done,
  })
  return { create, update, disable }
}

// ---------------------------------------------------------------- Public (anonymous) side
/** Item as the public page receives it: no notes, history, wishlist data; rating only if shared. */
export type PublicItem = Omit<LibraryItem, 'rating'> & { rating?: number | null }

export interface PublicProfile {
  show_ratings: boolean
  categories: { category: MediaCategory; total: number; completed: number; in_progress: number; planning: number; on_hold: number; dropped: number; avg_rating: number | null }[]
  favorites: PublicItem[]
  recent: PublicItem[]
}

export function usePublicProfile(token: string | undefined) {
  return useQuery({
    queryKey: ['public-profile', token],
    enabled: !!token,
    retry: false,
    queryFn: async () => unwrap(await supabase.rpc('public_profile', { p_token: token! }), 'profile') as PublicProfile | null,
  })
}

export function usePublicLibrary(token: string, category: MediaCategory | null, status: LibraryStatus | null, sort: string, search: string, page: number) {
  return useQuery({
    queryKey: ['public-library', token, category, status, sort, search, page],
    enabled: !!category,
    placeholderData: (prev) => prev,
    queryFn: async () => unwrap(await supabase.rpc('public_library', {
      p_token: token, p_category: category!, p_status: status, p_sort: sort, p_search: search.trim() || null, p_limit: 60, p_offset: page * 60,
    }), 'library') as { total: number; items: PublicItem[] } | null,
  })
}
