import { formatCredits } from '../../tutoring/format'
import { centsToLessonCredits, formatLessonCredits } from '../../tutoring/lessonCredits'
import { STUDENT_NEGATIVE_BALANCE_HINT } from '../../tutoring/studentCreditCopy'

type Props = {
  balanceCents: number
  classRateCents: number
}

export function StudentCreditsSummary({ balanceCents, classRateCents }: Props) {
  const credits = centsToLessonCredits(balanceCents, classRateCents)
  const tone =
    balanceCents > 0 ? 'text-green-700' : balanceCents < 0 ? 'text-red-700' : 'text-ink'
  const owes = balanceCents < 0

  return (
    <div>
      <p className="text-sm font-semibold text-ink-muted">
        {owes ? 'Balance (you owe)' : 'Your credits'}
      </p>
      <p className={`mt-1 font-display text-3xl font-semibold ${tone}`}>
        {formatLessonCredits(credits)}
      </p>
      {owes ? (
        <p className="mt-2 text-sm text-red-800">{STUDENT_NEGATIVE_BALANCE_HINT}</p>
      ) : null}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink-muted hover:text-ink">
          View in dollars
        </summary>
        <ul className="mt-2 space-y-1 text-ink-muted">
          <li>
            Balance: <span className="text-ink">{formatCredits(balanceCents)}</span>
          </li>
          <li>
            Your 50-min class rate:{' '}
            <span className="text-ink">{formatCredits(classRateCents)}</span>
          </li>
        </ul>
      </details>
    </div>
  )
}
