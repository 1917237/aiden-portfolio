import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTutoringSession } from '../../tutoring/useTutoringSession'

function resetRedirectUrl() {
  return `${window.location.origin}/tutoring/reset-password`
}

export function TutoringLogin() {
  const { session, loading } = useTutoringSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetting, setResetting] = useState(false)

  if (!loading && session) {
    return <Navigate to="/tutoring/dashboard" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setMessage(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
  }

  async function handleResetPassword() {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Enter your email first, then click Reset password.')
      setMessage(null)
      return
    }

    setResetting(true)
    setError(null)
    setMessage(null)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo: resetRedirectUrl(),
    })

    setResetting(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setMessage('Check your email for a password reset link.')
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-14">
      <p className="text-sm font-medium tracking-wide text-sage uppercase">Tutoring</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Student login</h1>
      <p className="mt-3 text-ink-muted">
        This page is only for students with an account. Ask your tutor for the link.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4 border border-line bg-bg-elevated/60 p-6">
        <label className="block">
          <span className="text-sm font-semibold">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2"
          />
        </label>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {message ? <p className="text-sm text-sage-deep">{message}</p> : null}

        <button
          type="submit"
          disabled={submitting || resetting || loading}
          className="w-full bg-sage-deep px-4 py-2 font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => void handleResetPassword()}
          disabled={submitting || resetting || loading}
          className="w-full border border-line bg-white px-4 py-2 font-semibold hover:bg-bg-elevated disabled:opacity-60"
        >
          {resetting ? 'Sending reset link…' : 'Reset password'}
        </button>
      </form>
    </div>
  )
}
