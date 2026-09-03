import { formatTimezoneLabel } from '../../tutoring/timezoneUtils'

type Props = {
  timeZone: string
  className?: string
}

export function TimesInTimezoneLabel({ timeZone, className = '' }: Props) {
  return (
    <p className={`text-sm text-ink-muted ${className}`.trim()}>
      Times shown in{' '}
      <strong className="font-semibold text-ink">{formatTimezoneLabel(timeZone)}</strong>
    </p>
  )
}
