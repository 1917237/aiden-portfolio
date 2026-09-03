import {
  cellKey,
  DAY_LABELS,
  formatTimeLabel,
  SCHEDULE_END_HOUR,
  SCHEDULE_HOURS,
  SCHEDULE_START_HOUR,
  SLOT_OFFSETS,
} from '../../tutoring/scheduleConfig'
import {
  cellStyle,
  outerGridStyle,
  SCHEDULE_GRID_HEIGHT,
  SCHEDULE_TIME_WIDTH,
} from '../../tutoring/scheduleLayout'

type WeeklyProps = {
  mode: 'weekly'
  selected: Set<string>
  onPointerDown: (key: string) => void
  onPointerEnter: (key: string) => void
  onPointerUp: () => void
  /** Inclusive start hour (default schedule start). */
  startHour?: number
  /** Exclusive end hour (default schedule end). */
  endHour?: number
}

type DailyProps = {
  mode: 'daily'
  isAvailable: (minutes: number) => boolean
  onToggle: (minutes: number) => void
  disabled?: boolean
  startHour?: number
  endHour?: number
}

type Props = (WeeklyProps | DailyProps) & {
  emptyMessage?: string
  showGrid?: boolean
}

export function ScheduleHourGrid(props: Props) {
  const showGrid = props.showGrid ?? true
  const startHour = props.startHour ?? SCHEDULE_START_HOUR
  const endHour = props.endHour ?? SCHEDULE_END_HOUR
  const hours =
    startHour === SCHEDULE_START_HOUR && endHour === SCHEDULE_END_HOUR
      ? SCHEDULE_HOURS
      : Array.from({ length: endHour - startHour }, (_, i) => startHour + i)

  if (!showGrid) {
    return (
      <div
        className="flex items-center justify-center bg-bg-elevated text-sm text-ink-muted"
        style={{ ...outerGridStyle, height: SCHEDULE_GRID_HEIGHT }}
      >
        {props.emptyMessage ?? 'Nothing to show.'}
      </div>
    )
  }

  const dayCount = props.mode === 'weekly' ? DAY_LABELS.length : 1
  const columns = `${SCHEDULE_TIME_WIDTH} repeat(${dayCount}, minmax(0, 1fr))`

  return (
    <div
      className="flex select-none flex-col overflow-hidden bg-white"
      style={{ ...outerGridStyle, height: SCHEDULE_GRID_HEIGHT }}
      onPointerUp={props.mode === 'weekly' ? props.onPointerUp : undefined}
      onPointerLeave={props.mode === 'weekly' ? props.onPointerUp : undefined}
    >
      <div className="grid shrink-0 bg-bg-elevated" style={{ gridTemplateColumns: columns }}>
        <div style={cellStyle} />
        {props.mode === 'weekly'
          ? DAY_LABELS.map((label) => (
              <div
                key={label}
                className="py-2 text-center text-sm font-semibold"
                style={cellStyle}
              >
                {label}
              </div>
            ))
          : (
              <div className="py-2 text-center text-sm font-semibold" style={cellStyle}>
                Available
              </div>
            )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {hours.map((hour) => (
          <div
            key={hour}
            className="grid min-h-0"
            style={{
              gridTemplateColumns: columns,
              gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
              minHeight: '3.5rem',
            }}
          >
            <div
              className="flex items-center justify-end bg-bg-elevated pr-3 text-xs font-medium text-ink"
              style={{ ...cellStyle, gridRow: '1 / -1' }}
            >
              {formatTimeLabel(hour * 60)}
            </div>

            {SLOT_OFFSETS.flatMap((offset, rowIndex) => {
              const startMinutes = hour * 60 + offset

              if (props.mode === 'weekly') {
                return DAY_LABELS.map((_, dayIndex) => {
                  const key = cellKey(dayIndex, startMinutes)
                  const on = props.selected.has(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      title={formatTimeLabel(startMinutes)}
                      style={{ ...cellStyle, gridRow: rowIndex + 1, gridColumn: dayIndex + 2 }}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        props.onPointerDown(key)
                      }}
                      onPointerEnter={() => props.onPointerEnter(key)}
                      className={`min-h-0 w-full cursor-pointer p-0 ${
                        on ? 'bg-sage hover:bg-sage-deep' : 'bg-white hover:bg-sage/20'
                      }`}
                    />
                  )
                })
              }

              return [
                <button
                  key={startMinutes}
                  type="button"
                  disabled={props.disabled}
                  style={{ ...cellStyle, gridRow: rowIndex + 1, gridColumn: 2 }}
                  onClick={() => props.onToggle(startMinutes)}
                  className={`min-h-0 w-full cursor-pointer p-0 pl-3 text-left text-sm disabled:opacity-60 ${
                    props.isAvailable(startMinutes)
                      ? 'bg-sage text-white hover:bg-sage-deep'
                      : 'bg-white hover:bg-sage/20'
                  }`}
                >
                  {props.isAvailable(startMinutes) ? formatTimeLabel(startMinutes) : ''}
                </button>,
              ]
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
