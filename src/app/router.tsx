/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/misc'
import { RequireAuth } from '@/features/auth/auth'
import { FullPageSpinner, LoginPage } from '@/features/auth/screens'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { LibraryRoute } from '@/features/library/LibraryPage'

const MediaDetailPage = lazy(() => import('@/features/media-details/MediaDetailPage').then((m) => ({ default: m.MediaDetailPage })))
const StatsPage = lazy(() => import('@/features/statistics/StatsPage').then((m) => ({ default: m.StatsPage })))
const ImportPage = lazy(() => import('@/features/imports/ImportPage').then((m) => ({ default: m.ImportPage })))
const FranchisesPage = lazy(() => import('@/features/franchises/FranchisesPage').then((m) => ({ default: m.FranchisesPage })))
const FranchisePage = lazy(() => import('@/features/franchises/FranchisePage').then((m) => ({ default: m.FranchisePage })))
const PublicProfilePage = lazy(() => import('@/features/sharing/PublicProfilePage').then((m) => ({ default: m.PublicProfilePage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

const page = (el: ReactNode) => <Suspense fallback={<FullPageSpinner />}>{el}</Suspense>

function RouteError() {
  const err = useRouteError()
  // Technical details go to the console, not the screen.
  console.error('[rubaka] route error', err)
  const notFound = isRouteErrorResponse(err) && err.status === 404
  return (
    <div className="p-6">
      <EmptyState
        title={notFound ? 'Page not found' : 'Something went wrong'}
        description={notFound ? 'This address does not exist.' : 'The page failed to load. Reloading usually helps; your data is safe.'}
        action={<div className="flex gap-2"><Button onClick={() => window.location.reload()}>Reload</Button><Button variant="primary" asChild><Link to="/">Dashboard</Link></Button></div>}
      />
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  // Public, read-only profile: no sign-in; the token in the address is the only key.
  { path: '/u/:token', element: page(<PublicProfilePage />), errorElement: <RouteError /> },
  {
    path: '/',
    element: <RequireAuth><AppShell /></RequireAuth>,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'media/:id', element: page(<MediaDetailPage />) },
      { path: 'franchises', element: page(<FranchisesPage />) },
      { path: 'franchises/:id', element: page(<FranchisePage />) },
      { path: 'stats', element: page(<StatsPage />) },
      { path: 'import', element: page(<ImportPage />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: ':slug', element: <LibraryRoute /> },
      { path: '*', element: <RouteError /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })
