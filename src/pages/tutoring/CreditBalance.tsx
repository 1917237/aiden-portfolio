import { creditBalanceTone, formatSignedCredits } from '../../tutoring/format'

type Props = {
  cents: number
  className?: string
}

const toneClass = {
  positive: 'text-green-700',
  negative: 'text-red-700',
  neutral: 'text-ink-muted',
} as const

export function CreditBalance({ cents, className = '' }: Props) {
  const tone = creditBalanceTone(cents)
  return (
    <span className={`font-semibold ${toneClass[tone]} ${className}`}>
      {formatSignedCredits(cents)}
    </span>
  )
}
