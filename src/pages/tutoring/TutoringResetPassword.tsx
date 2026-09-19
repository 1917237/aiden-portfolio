import { type FormEvent, useEffect, useId, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TUTORING_BRAND_NAME, TUTORING_BRAND_TAGLINE } from '../../tutoring/brand'
import {
  PasswordStrength,
  tutoringPasswordRules,
  usePasswordStrength,
} from '../../tutoring/PasswordStrength'

export function TutoringResetPassword() {
  const passwordId = useId()
  const confirmId = useId()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const strength = usePasswordStrength(password, { rules: tutoringPasswordRules })

  useEffect(() => {
    let active = true

    const hash = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const errorCode = params.get('error_code') || params.get('error')
    const errorDescription = params.get('error_description')
    if (errorCode) {
      setLinkError(
        errorDescription?.replace(/\+/g, ' ') ||
          'This invite or reset link is invalid or has expired.',
      )
      setChecking(false)
      setReady(false)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (
        event === 'PASSWORD_RECOVERY' ||
        event === 'SIGNED_IN' ||
        event === 'USER_UPDATED' ||
        session
      ) {
        setReady(true)
        setChecking(false)
        setLinkError(null)
      }
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) {
        setReady(true)
        setLinkError(null)
      }
      setChecking(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!strength.rules.every((r) => r.met) || strength.guessable) {
      setError('Choose a stronger password that meets every requirement.')
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
      <div className="tutoring-enter">
        <p className="tutoring-eyebrow">{TUTORING_BRAND_NAME}</p>
        <h1 className="tutoring-title">Create your password</h1>
        <p className="mt-3 text-sm text-ink-muted">
          {TUTORING_BRAND_TAGLINE}. Set a password to finish joining, then you can sign in anytime.
        </p>
      </div>

      {checking ? (
        <p className="tutoring-enter tutoring-enter-delay-1 mt-8 text-sm text-ink-muted">
          Verifying invite link…
        </p>
      ) : linkError || !ready ? (
        <div className="tutoring-panel tutoring-enter tutoring-enter-delay-1 mt-8 space-y-4 p-6">
          <p className="text-sm text-red-700">
            {linkError ||
              'This invite or reset link is invalid or has expired. Ask your tutor to send a new invite.'}
          </p>
          <Link to="/tutoring/login" className="tutoring-btn inline-flex">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="tutoring-panel tutoring-enter tutoring-enter-delay-1 mt-8 space-y-4 p-6"
        >
          <label className="block" htmlFor={passwordId}>
            <span className="text-sm font-semibold">New password</span>
            <input
              id={passwordId}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              spellCheck={false}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Type a password"
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5"
            />
          </label>

          <PasswordStrength value={password} className="mt-1" />

          <label className="block" htmlFor={confirmId}>
            <span className="text-sm font-semibold">Confirm password</span>
            <input
              id={confirmId}
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2.5"
            />
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={submitting}
            className="tutoring-btn-primary w-full px-4 py-2.5 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save password & continue'}
          </button>
        </form>
      )}
    </div>
  )
}
