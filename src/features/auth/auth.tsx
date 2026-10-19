/**
 * RUBAKA
 * Personal Media Backlog
 *
 * Created by RUBAKA
 * Copyright (c) 2026 RUBAKA
 */
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { loadRemoteSettings } from '@/features/settings/settings-store'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { FullPageSpinner, NotOwnerScreen, SetupScreen } from './screens'

interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  /** null while unknown. */
  isOwner: boolean | null
  ownerCheckError: unknown
  recheckOwner: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  const [ownerCheckError, setOwnerCheckError] = useState<unknown>(null)
  const [checkNonce, setCheckNonce] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setIsOwner(null)
        qc.clear()
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.rpc('am_i_owner').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.error('[rubaka] owner check', error)
        setOwnerCheckError(error)
        setIsOwner(null)
      } else {
        setOwnerCheckError(null)
        setIsOwner(Boolean(data))
        if (data) void loadRemoteSettings()
      }
    })
    return () => {
      cancelled = true
    }
  }, [userId, checkNonce])

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    isOwner,
    ownerCheckError,
    recheckOwner: () => setCheckNonce((n) => n + 1),
    signOut: async () => {
      await supabase.auth.signOut()
      qc.clear()
    },
  }), [session, loading, isOwner, ownerCheckError, qc])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Gate for every private route. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, isOwner, ownerCheckError } = useAuth()
  const location = useLocation()
  if (!isSupabaseConfigured) return <SetupScreen />
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (isOwner === null && !ownerCheckError) return <FullPageSpinner />
  if (isOwner === false || ownerCheckError) return <NotOwnerScreen />
  return <>{children}</>
}
