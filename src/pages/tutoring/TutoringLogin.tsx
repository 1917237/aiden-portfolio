import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TUTORING_BRAND_NAME, TUTORING_BRAND_TAGLINE } from '../../tutoring/brand'
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
      <div className="tutoring-enter">
        <p className="tutoring-eyebrow">{TUTORING_BRAND_NAME}</p>
        <h1 className="tutoring-title">Student login</h1>
        <p className="mt-3 text-sm text-ink-muted">
          {TUTORING_BRAND_TAGLINE}. Sign in with the account your tutor set up for you.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="tutoring-panel tutoring-enter tutoring-enter-delay-1 mt-8 space-y-4 p-6"
      >
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
          className="tutoring-btn-primary w-full px-4 py-2.5 disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <button
          type="button"
          onClick={() => void handleResetPassword()}
          disabled={submitting || resetting || loading}
          className="tutoring-btn w-full disabled:opacity-60"
        >
          {resetting ? 'Sending reset link…' : 'Reset password'}
        </button>
      </form>
    </div>
  )
}
