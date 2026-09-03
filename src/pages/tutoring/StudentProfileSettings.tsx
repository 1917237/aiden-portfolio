import { type FormEvent, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

type Props = {
  fullName: string
  onSaved: (fullName: string) => void
}

export function StudentProfileSettings({ fullName, onSaved }: Props) {
  const [name, setName] = useState(fullName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setName(fullName)
  }, [fullName])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter your name.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)

    const { error: rpcError } = await supabase.rpc('update_my_display_name', {
      p_full_name: trimmed,
    })

    if (rpcError) {
      setSaving(false)
      if (
        rpcError.message.includes('Could not find the function') ||
        rpcError.message.includes('update_my_display_name')
      ) {
        setError('Run supabase/33-student-name-legacy-book.sql in the Supabase SQL Editor, then try again.')
        return
      }
      setError(rpcError.message)
      return
    }

    setName(trimmed)
    onSaved(trimmed)
    setMessage('Name updated.')
    setSaving(false)
  }

  return (
    <div>
      <p className="text-sm font-semibold text-ink">Your profile</p>
      <p className="mt-1 text-xs text-ink-muted">This is the name your tutor sees.</p>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-3 space-y-3">
        <label className="block text-sm font-medium">
          Display name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            className="mt-1 w-full border border-line px-3 py-2 text-base"
            autoComplete="name"
          />
        </label>
        <button
          type="submit"
          disabled={saving || name.trim() === fullName.trim()}
          className="w-full border border-line bg-sage px-4 py-2 text-sm font-semibold hover:bg-sage-deep disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {message ? <p className="text-sm text-sage-deep">{message}</p> : null}
      </form>
    </div>
  )
}
