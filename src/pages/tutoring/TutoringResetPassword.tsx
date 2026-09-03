import { type FormEvent, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

export function TutoringResetPassword() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true)
        setChecking(false)
      }
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) setReady(true)
      setChecking(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    setDone(true)
    setSubmitting(false)
  }

  if (done) {
    return <Navigate to="/tutoring/dashboard" replace />
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-14">
      <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">New password</h1>
      <p className="mt-3 text-ink-muted">Choose a new password for your account.</p>

      {checking ? (
        <p className="mt-8 text-sm text-ink-muted">Verifying reset link…</p>
      ) : !ready ? (
        <div className="mt-8 space-y-4 border border-line bg-bg-elevated/60 p-6">
          <p className="text-sm text-red-700">
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
          <Link
            to="/tutoring/login"
            className="inline-block border border-line px-4 py-2 text-sm font-semibold hover:bg-bg-elevated"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4 border border-line bg-bg-elevated/60 p-6">
          <label className="block">
            <span className="text-sm font-semibold">New password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold">Confirm password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2"
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-sage-deep px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </div>
  )
}
