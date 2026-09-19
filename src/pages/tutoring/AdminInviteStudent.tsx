import { type FormEvent, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

type Props = {
  onInvited: () => void
}

async function readFunctionError(fnError: unknown): Promise<string> {
  if (fnError instanceof FunctionsHttpError) {
    try {
      const body = await fnError.context.json()
      if (body && typeof body === 'object' && 'error' in body) {
        return String((body as { error: unknown }).error)
      }
      return typeof body === 'string' ? body : JSON.stringify(body)
    } catch {
      try {
        return await fnError.context.text()
      } catch {
        /* fall through */
      }
    }
  }
  if (fnError && typeof fnError === 'object' && 'message' in fnError) {
    return String((fnError as { message: string }).message)
  }
  return 'Invite failed'
}

export function AdminInviteStudent({ onInvited }: Props) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const trimmedEmail = email.trim().toLowerCase()
    const trimmedName = fullName.trim()
    if (!trimmedEmail || !trimmedName) {
      setError('Enter the student email and name.')
      return
    }

    setSubmitting(true)

    const { data, error: fnError } = await supabase.functions.invoke('invite-student', {
      body: { email: trimmedEmail, fullName: trimmedName },
    })

    setSubmitting(false)

    if (fnError) {
      const raw = await readFunctionError(fnError)
      setError(
        /Failed to send a request to the Edge Function|Failed to fetch|NOT_FOUND|404/i.test(raw)
          ? 'Invite function is not deployed yet. In Terminal run: npx supabase functions deploy invite-student --project-ref dntujelwmbypgtxnhyin'
          : raw,
      )
      return
    }

    if (data && typeof data === 'object' && 'error' in data) {
      setError(String((data as { error: string }).error))
      return
    }

    const resent = Boolean(data && typeof data === 'object' && 'resent' in data && data.resent)
    setMessage(
      resent
        ? `Account already existed. sent a new password setup email to ${trimmedEmail}.`
        : `Invite sent to ${trimmedEmail}. They can set a password from the email link.`,
    )
    setEmail('')
    setFullName('')
    onInvited()
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-1">
          <span className="text-sm font-semibold">Full name</span>
          <input
            type="text"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2"
          />
        </label>
        <label className="block sm:col-span-1">
          <span className="text-sm font-semibold">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full border border-line bg-white px-3 py-2"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-sage-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Sending invite…' : 'Send invite'}
          </button>
        </div>
      </form>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="mt-2 text-sm text-sage-deep">{message}</p> : null}
    </div>
  )
}
