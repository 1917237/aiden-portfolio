import { COMMON_TIMEZONES, formatTimezoneLabel, getBrowserTimezone } from '../../tutoring/timezoneUtils'

type Props = {
  value: string
  onChange: (timeZone: string) => void
}

export function TimezoneSelect({ value, onChange }: Props) {
  const browserZone = getBrowserTimezone()
  const options = Array.from(new Set([browserZone, ...COMMON_TIMEZONES]))

  return (
    <label className="block text-sm">
      <span className="sr-only">Timezone</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-[12rem] border border-line bg-white px-3 py-2 text-sm font-semibold"
      >
        {options.map((zone) => (
          <option key={zone} value={zone}>
            {formatTimezoneLabel(zone)}
            {zone === browserZone ? ' · device' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
