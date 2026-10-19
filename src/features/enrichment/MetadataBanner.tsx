/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageDown, LoaderCircle, Square } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/misc'
import { invalidateLibrary } from '@/features/tracking/api'
import { CATEGORY_CONFIG } from '@/lib/categories'
import { friendlyError, supabase } from '@/lib/supabase'
import type { MediaCategory } from '@/types/db'
import { cancelEnrichment, runEnrichment, useEnrichment } from './runner'

/** Prompts to fetch covers/metadata for titles that have none yet, and shows live progress. */
export function MetadataBanner({ category }: { category: MediaCategory }) {
  const qc = useQueryClient()
  const run = useEnrichment()
  const pending = useQuery({
    queryKey: ['enrichment-pending', category],
    queryFn: async () => {
      const { count, error } = await supabase.from('media').select('id', { count: 'exact', head: true })
        .eq('category', category).eq('enrichment_state', 'pending')
      if (error) throw error
      return count ?? 0
    },
    refetchInterval: run.running ? 5000 : false,
  })

  const start = async () => {
    try {
      await runEnrichment(category)
      const s = useEnrichment.getState()
      toast.success(`Metadata: ${s.matched} matched${s.review ? `, ${s.review} to review` : ''}${s.unresolved ? `, ${s.unresolved} not found` : ''}`)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      invalidateLibrary(qc)
      qc.invalidateQueries({ queryKey: ['enrichment-pending'] })
      qc.invalidateQueries({ queryKey: ['enrichment-counts'] })
    }
  }

  if (!run.running && !pending.data) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5 text-[13px]" role="status" aria-live="polite">
      <ImageDown className="size-4 shrink-0 text-accent-hover" />
      {run.running ? (
        <>
          <span className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" /> Fetching covers and info… {run.processed.toLocaleString()} / {run.total.toLocaleString()}</span>
          <ProgressBar ratio={run.total ? run.processed / run.total : null} className="w-40" />
          {run.current && <span className="max-w-60 truncate text-xs text-fg-3">{run.current}</span>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={cancelEnrichment}><Square /> Stop</Button>
        </>
      ) : (
        <>
          <span>{pending.data!.toLocaleString()} {CATEGORY_CONFIG[category].label.toLowerCase()} have no cover or info yet.</span>
          <Button size="sm" variant="primary" onClick={() => void start()}>Fetch now</Button>
          <Link to="/import" className="ml-auto text-xs text-fg-3 hover:text-fg">Metadata queue →</Link>
        </>
      )}
    </div>
  )
}
