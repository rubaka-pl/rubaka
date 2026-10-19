import { zodResolver } from '@hookform/resolvers/zod'
import { Copy, LoaderCircle, LogOut, RotateCcw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form-controls'
import { friendlyError, isSupabaseConfigured, supabase, usesSecretKey } from '@/lib/supabase'
import { Logo } from '@/components/layout/Logo'
import { useAuth } from './auth'

export function FullPageSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center" role="status" aria-label="Loading">
      <LoaderCircle className="size-6 animate-spin text-accent" />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-card">{children}</div>
        <p className="mt-6 text-center text-xs text-fg-3">Created by RUBAKA © 2026</p>
      </div>
    </main>
  )
}

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})

export function LoginPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  if (!isSupabaseConfigured) return <SetupScreen />
  if (session) return <Navigate to={from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) {
      form.setError('root', { message: error.message === 'Invalid login credentials' ? 'Wrong email or password.' : friendlyError(error) })
      return
    }
    navigate(from, { replace: true })
  })

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-[13px] text-fg-3">Private library. There is no public registration.</p>
      <form className="mt-5 flex flex-col gap-3.5" onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus {...form.register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        {form.formState.errors.root && <p className="text-[13px] text-danger" role="alert">{form.formState.errors.root.message}</p>}
        <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting} className="mt-1">Sign in</Button>
      </form>
    </Shell>
  )
}

export function SetupScreen() {
  if (usesSecretKey) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-danger">Secret key detected — refused</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
          <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_ANON_KEY</code> contains a <b>secret / service_role</b> key. It bypasses all
          security rules and must never be used in the browser. Replace it with the <b>publishable</b> key
          (<code className="rounded bg-surface-2 px-1">sb_publishable_…</code>, or the legacy “anon” key) from Supabase → Project Settings → API Keys,
          then restart the dev server. If the secret key was ever published, rotate it in Supabase.
        </p>
      </Shell>
    )
  }
  return (
    <Shell>
      <h1 className="text-lg font-semibold">Connect Supabase</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
        This build has no Supabase configuration. Set <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_ANON_KEY</code> (in <code className="rounded bg-surface-2 px-1">.env.local</code> or the
        GitHub Actions secrets) and rebuild. See the README, section “Supabase setup”.
      </p>
    </Shell>
  )
}

export function NotOwnerScreen() {
  const { user, signOut, ownerCheckError, recheckOwner } = useAuth()
  const sql = `insert into app_private.owner (user_id) values ('${user?.id}');`
  return (
    <Shell>
      {ownerCheckError ? (
        <>
          <h1 className="text-lg font-semibold">Cannot verify access</h1>
          <p className="mt-2 text-[13px] text-fg-2">{friendlyError(ownerCheckError)}</p>
          <p className="mt-2 text-[13px] text-fg-3">If the database was just created, make sure all migrations were applied.</p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold">Owner not configured</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-fg-2">
            You are signed in as <b>{user?.email}</b>, but this account is not the library owner. Row Level Security blocks all data
            until the owner is set. Run this once in the Supabase SQL editor:
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-surface-2 p-2.5 text-[11px] text-fg">{sql}</pre>
          <Button size="sm" className="mt-2" onClick={() => { void navigator.clipboard.writeText(sql); toast.success('Copied') }}>
            <Copy /> Copy SQL
          </Button>
        </>
      )}
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={recheckOwner}><RotateCcw /> Check again</Button>
        <Button variant="ghost" onClick={() => void signOut()}><LogOut /> Sign out</Button>
      </div>
    </Shell>
  )
}
