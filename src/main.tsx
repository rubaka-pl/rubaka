/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { Toaster } from 'sonner'
import { router } from '@/app/router'
import { TooltipProvider } from '@/components/ui/overlays'
import { AuthProvider } from '@/features/auth/auth'
import { applyTheme, getSettingsSnapshot } from '@/features/settings/settings-store'
import './styles/index.css'

applyTheme(getSettingsSnapshot().theme)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      // Do not hammer the free-tier database: retry transient failures twice.
      retry: (count, err) => count < 2 && !/permission|JWT|not found/i.test(String((err as Error)?.message)),
    },
  },
  mutationCache: new MutationCache({
    onError: (err) => console.error('[rubaka] mutation failed', err),
  }),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </TooltipProvider>
      </MotionConfig>
      <Toaster theme="system" position="bottom-right" richColors closeButton
        toastOptions={{ className: '!bg-surface !text-fg !border-line' }} />
    </QueryClientProvider>
  </StrictMode>,
)
