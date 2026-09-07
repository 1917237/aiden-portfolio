import { centsToLessonCredits, formatLessonCredits } from '../../tutoring/lessonCredits'

type Props = {
  balanceCents: number
  classRateCents: number
}

/** Compact balance in the student header so Credits can sit lower on the page. */
export function StudentBalanceChip({ balanceCents, classRateCents }: Props) {
  const credits = centsToLessonCredits(balanceCents, classRateCents)
  const owes = balanceCents < 0
  const tone = owes ? 'text-red-800' : balanceCents > 0 ? 'text-sage-deep' : 'text-ink-muted'

  return (
    <div
      className="border border-line bg-bg-elevated px-3 py-1.5 text-sm"
      title={owes ? 'Balance owed to your tutor' : 'Lesson credits available'}
    >
      <span className="text-ink-muted">{owes ? 'You owe' : 'Credits'} </span>
      <span className={`font-semibold ${tone}`}>{formatLessonCredits(credits)}</span>
    </div>
  )
}
