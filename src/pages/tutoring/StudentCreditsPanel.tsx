import { type FormEvent, useMemo, useState } from 'react'
import { formatCredits } from '../../tutoring/format'
import { formatLessonCredits, lessonCreditsToCents } from '../../tutoring/lessonCredits'
import { supabase } from '../../lib/supabase'
import { STUDENT_CREDITS_POLICY } from '../../tutoring/studentCreditCopy'
import { CollapsibleSection } from './CollapsibleSection'
import { StudentCreditHistory } from './StudentCreditHistory'
import { StudentCreditsSummary } from './StudentCreditsSummary'

type Props = {
  studentId: string
  creditBalance: number
  classRateCents: number
  refreshKey?: number
}

export function StudentCreditsPanel({
  studentId,
  creditBalance,
  classRateCents,
  refreshKey = 0,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [creditAmount, setCreditAmount] = useState('1')
  const [note, setNote] = useState('Zelle payment')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [requestsRefreshKey, setRequestsRefreshKey] = useState(0)

  const requestedCents = useMemo(() => {
    const credits = parseFloat(creditAmount)
    if (Number.isNaN(credits) || credits <= 0) return 0
    return lessonCreditsToCents(credits, classRateCents)
  }, [classRateCents, creditAmount])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const credits = parseFloat(creditAmount)
    if (Number.isNaN(credits) || credits <= 0) {
      setError('Enter a valid number of credits.')
      return
    }

    const amountCents = lessonCreditsToCents(credits, classRateCents)
    if (amountCents <= 0) {
      setError('Enter a valid number of credits.')
      return
    }

    setSubmitting(true)

    const { error: rpcError } = await supabase.rpc('request_credits', {
      p_amount_cents: amountCents,
      p_note: note || null,
    })

    setSubmitting(false)

    if (rpcError) {
      setError(
        rpcError.message.includes('Could not find the function')
          ? 'Run supabase/14-credit-requests.sql in the SQL Editor first.'
          : rpcError.message,
      )
      return
    }

    setMessage(
      `Submitted ${formatLessonCredits(credits)} (${formatCredits(amountCents)}) for review.`,
    )
    setCreditAmount('1')
    setShowForm(false)
    setRequestsRefreshKey((value) => value + 1)
  }

  const historyRefreshKey = refreshKey + requestsRefreshKey

  return (
    <div className="mt-3 grid gap-4 border border-line bg-bg-elevated/60 p-6">
      <StudentCreditsSummary balanceCents={creditBalance} classRateCents={classRateCents} />

      <p className="text-sm text-ink-muted">{STUDENT_CREDITS_POLICY}</p>

      <div className="border-t border-line pt-4">
        {!showForm ? (
          <button
            type="button"
            onClick={() => {
              setShowForm(true)
              setError(null)
              setMessage(null)
            }}
            className="border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-bg-elevated"
          >
            Add credits
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm font-semibold">Request credits</p>
            <p className="text-xs text-ink-muted">
              How many credits are you paying for? Your tutor will confirm before they are added.
            </p>
            <label className="block">
              <span className="text-sm font-semibold">Credits</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                required
                value={creditAmount}
                onChange={(event) => setCreditAmount(event.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2"
              />
              {requestedCents > 0 ? (
                <span className="mt-1 block text-sm text-ink-muted">
                  = {formatCredits(requestedCents)} payment
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Note</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="bg-sage-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border border-line px-4 py-2 text-sm font-semibold hover:bg-bg-elevated"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-sage-deep">{message}</p> : null}

      <div className="border-t border-line pt-4">
        <CollapsibleSection
          title="Credit history"
          description="Requests, payments, lesson holds, refunds, and length changes."
          defaultOpen={false}
        >
          <StudentCreditHistory
            studentId={studentId}
            classRateCents={classRateCents}
            refreshKey={historyRefreshKey}
          />
        </CollapsibleSection>
      </div>
    </div>
  )
}
