import { useMemo } from 'react'
import {
  formatTimeLabel,
  SCHEDULE_END_HOUR,
  SCHEDULE_START_HOUR,
  SLOT_INTERVAL_MINUTES,
} from '../../tutoring/scheduleConfig'
import { cellStyle, outerGridStyle, SCHEDULE_TIME_WIDTH } from '../../tutoring/scheduleLayout'
import type { AvailabilitySlot } from '../../tutoring/types'
import { isoToZonedParts, formatTimezoneLabel, type ZonedWeekDay } from '../../tutoring/timezoneUtils'

type Props = {
  weekDays: ZonedWeekDay[]
  slotsByCell: Map<string, AvailabilitySlot>
  takenCellsByKey?: Set<string>
  timeZone?: string
  selectedSlotId: string | null
  onSelectSlot: (slot: AvailabilitySlot) => void
  mode?: 'book' | 'reschedule'
}

function cellMapKey(dateKey: string, startMinutes: number) {
  return `${dateKey}-${startMinutes}`
}

function buildMinuteRows(startHour: number, endHour: number) {
  const rows: number[] = []
  for (let hour = startHour; hour < endHour; hour += 1) {
    for (let offset = 0; offset < 60; offset += SLOT_INTERVAL_MINUTES) {
      rows.push(hour * 60 + offset)
    }
  }
  return rows
}

export function StudentWhen2MeetGrid({
  weekDays,
  slotsByCell,
  takenCellsByKey,
  timeZone,
  selectedSlotId,
  onSelectSlot,
  mode = 'book',
}: Props) {
  const actionVerb = mode === 'reschedule' ? 'Reschedule to' : 'Book'
  const startHour = SCHEDULE_START_HOUR
  const endHour = SCHEDULE_END_HOUR
  const minuteRows = useMemo(
    () => buildMinuteRows(startHour, endHour),
    [endHour, startHour],
  )

  const columns = `${SCHEDULE_TIME_WIDTH} repeat(7, minmax(0, 1fr))`
  const endLabel = endHour >= 24 ? '12 AM' : formatTimeLabel(endHour * 60)

  return (
    <div className="overflow-hidden bg-white" style={outerGridStyle}>
      <div className="grid sticky top-0 z-10 bg-bg-elevated" style={{ gridTemplateColumns: columns }}>
        <div style={cellStyle} />
        {weekDays.map((day) => (
          <div key={day.dateKey} className="py-2 text-center" style={cellStyle}>
            <p className="text-xs font-semibold text-ink-muted">{day.label}</p>
            <p className={`text-lg font-semibold leading-tight ${day.isToday ? 'text-sage-deep' : ''}`}>
              {day.dayNumber}
            </p>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid #c5cdc0' }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: columns,
            gridTemplateRows: `repeat(${minuteRows.length}, 1.15rem)`,
          }}
        >
          {minuteRows.map((startMinutes, rowIndex) => {
            const showLabel = startMinutes % 60 === 0
            return (
              <div key={`row-${startMinutes}`} className="contents">
                <div
                  className="flex items-start justify-end bg-bg-elevated pr-2 pt-0.5 text-[10px] font-medium text-ink-muted"
                  style={{
                    ...cellStyle,
                    gridColumn: 1,
                    gridRow: rowIndex + 1,
                  }}
                >
                  {showLabel ? formatTimeLabel(startMinutes) : ''}
                </div>

                {weekDays.map((day, dayIndex) => {
                  const key = cellMapKey(day.dateKey, startMinutes)
                  const slot = slotsByCell.get(key)
                  const available = Boolean(slot)
                  const taken = Boolean(!available && takenCellsByKey?.has(key))
                  const selected = Boolean(slot && slot.id === selectedSlotId)

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!available}
                      title={
                        available
                          ? `${day.label} ${day.dayNumber} · ${formatTimeLabel(startMinutes)}`
                          : taken
                            ? `${day.label} ${day.dayNumber} · ${formatTimeLabel(startMinutes)} · another lesson is scheduled`
                            : undefined
                      }
                      aria-label={
                        available
                          ? `${actionVerb} ${formatTimeLabel(startMinutes)} on ${day.label} ${day.dayNumber}`
                          : taken
                            ? `${formatTimeLabel(startMinutes)} on ${day.label} ${day.dayNumber} is taken`
                            : undefined
                      }
                      onClick={() => {
                        if (slot) onSelectSlot(slot)
                      }}
                      style={{
                        ...cellStyle,
                        gridColumn: dayIndex + 2,
                        gridRow: rowIndex + 1,
                      }}
                      className={`min-h-0 w-full p-0 transition-colors ${
                        selected
                          ? 'bg-sage-deep'
                          : available
                            ? 'cursor-pointer bg-sage hover:bg-sage-deep'
                            : taken
                              ? 'cursor-default bg-amber-100'
                              : 'cursor-default bg-[#f3f5f2]'
                      }`}
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line bg-bg-elevated/40 px-3 py-2 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 bg-sage" />{' '}
          {mode === 'reschedule' ? 'Available — click to pick' : 'Available — click to book'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 bg-amber-100 ring-1 ring-amber-300" /> Taken
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 bg-[#f3f5f2] ring-1 ring-[#c5cdc0]" /> Unavailable
        </span>
        <span className="text-ink-muted/80">
          {formatTimeLabel(startHour * 60)} – {endLabel}
          {timeZone ? ` · ${formatTimezoneLabel(timeZone)}` : ''}
        </span>
      </div>
    </div>
  )
}

export function buildTakenCellsByKey(
  takenStartIsos: string[],
  timeZone: string,
): Set<string> {
  const keys = new Set<string>()
  for (const iso of takenStartIsos) {
    const { dateKey, startMinutes } = isoToZonedParts(iso, timeZone)
    const snapped = Math.round(startMinutes / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES
    keys.add(cellMapKey(dateKey, snapped))
  }
  return keys
}

export function buildSlotsByCell(
  slots: AvailabilitySlot[],
  timeZone: string,
): Map<string, AvailabilitySlot> {
  const map = new Map<string, AvailabilitySlot>()
  for (const slot of slots) {
    const { dateKey, startMinutes } = isoToZonedParts(slot.start_time, timeZone)
    const snapped = Math.round(startMinutes / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES
    const key = cellMapKey(dateKey, snapped)
    if (!map.has(key)) map.set(key, slot)
  }
  return map
}
