import type { CalendarBooking } from '../../tutoring/calendarDayEvents'
import { TUTOR_SCHEDULE_TIMEZONE } from '../../tutoring/config'
import { formatTimeLabel } from '../../tutoring/scheduleConfig'
import { SCHEDULE_TIME_WIDTH, cellStyle } from '../../tutoring/scheduleLayout'
import type { Blockout, DateAvailability, WeeklyCell } from '../../tutoring/scheduleTypes'
import { displayToTutorCivil } from '../../tutoring/scheduleTimezoneMap'
import {
  WEEK_ROW_HEIGHT_PX,
  WEEK_TIME_SLOTS,
  durationToHeightPx,
  getWeekCellState,
  isoToMinutes,
  minutesToTopPx,
  type WeekCellState,
} from '../../tutoring/weekCalendarUtils'
import { isoToZonedParts, type ZonedWeekDay } from '../../tutoring/timezoneUtils'

export type SlotClickPayload = {
  dateKey: string
  startMinutes: number
  cellState: WeekCellState
}

type Props = {
  weekDays: ZonedWeekDay[]
  weeklyCells: WeeklyCell[]
  dateExtras: DateAvailability[]
  blockouts: Blockout[]
  bookings: CalendarBooking[]
  timeZone: string
  onSlotClick: (payload: SlotClickPayload) => void
  onBookingClick: (dateKey: string, bookingId: string) => void
}

function cellBg(state: ReturnType<typeof getWeekCellState>) {
  if (state === 'blocked') return 'bg-red-100'
  if (state === 'extra') return 'bg-sky-100'
  if (state === 'available') return 'bg-white'
  return 'bg-bg-elevated/80'
}

function displayCellState(
  dateKey: string,
  startMinutes: number,
  weeklyCells: WeeklyCell[],
  dateExtras: DateAvailability[],
  blockouts: Blockout[],
  displayTimeZone: string,
): WeekCellState {
  const tutor = displayToTutorCivil(dateKey, startMinutes, displayTimeZone, TUTOR_SCHEDULE_TIMEZONE)
  return getWeekCellState(
    tutor.dateKey,
    tutor.dayOfWeek,
    tutor.startMinutes,
    weeklyCells,
    dateExtras,
    blockouts,
  )
}

export function WeekCalendarGrid({
  weekDays,
  weeklyCells,
  dateExtras,
  blockouts,
  bookings,
  timeZone,
  onSlotClick,
  onBookingClick,
}: Props) {
  const gridHeight = WEEK_TIME_SLOTS.length * WEEK_ROW_HEIGHT_PX

  return (
    <div className="mt-4 overflow-auto border border-line" style={{ maxHeight: 'calc(100svh - 14rem)' }}>
      <div className="min-w-[760px]">
        <div className="sticky top-0 z-20 flex border-b border-line bg-white">
          <div style={{ width: SCHEDULE_TIME_WIDTH }} className="shrink-0 bg-bg-elevated" />
          {weekDays.map((day) => (
            <div
              key={day.dateKey}
              className={`flex-1 border-l border-line px-2 py-2 ${
                day.isToday ? 'border-t-4 border-t-ink bg-bg-elevated/40' : 'bg-bg-elevated/20'
              }`}
            >
              <p className="text-xs font-semibold uppercase text-ink-muted">{day.label}</p>
              <p className="text-lg font-semibold">{day.dayNumber}</p>
            </div>
          ))}
        </div>

        <div className="flex">
          <div className="shrink-0 bg-bg-elevated" style={{ width: SCHEDULE_TIME_WIDTH }}>
            {WEEK_TIME_SLOTS.map((minutes) => (
              <div
                key={minutes}
                className="pr-2 text-right text-[10px] text-ink-muted"
                style={{ height: WEEK_ROW_HEIGHT_PX, lineHeight: `${WEEK_ROW_HEIGHT_PX}px` }}
              >
                {minutes % 60 === 0 ? formatTimeLabel(minutes) : ''}
              </div>
            ))}
          </div>

          <div className="flex flex-1">
            {weekDays.map((day) => {
              const dayBookings = bookings.filter(
                (b) => b.date_key === day.dateKey && b.status === 'booked',
              )

              return (
                <div
                  key={day.dateKey}
                  className="relative flex-1 border-l border-line"
                  style={{ height: gridHeight }}
                >
                  {WEEK_TIME_SLOTS.map((minutes) => {
                    const state = displayCellState(
                      day.dateKey,
                      minutes,
                      weeklyCells,
                      dateExtras,
                      blockouts,
                      timeZone,
                    )
                    return (
                      <button
                        key={minutes}
                        type="button"
                        onClick={() =>
                          onSlotClick({
                            dateKey: day.dateKey,
                            startMinutes: minutes,
                            cellState: state,
                          })
                        }
                        className={`block w-full p-0 ${cellBg(state)} hover:brightness-95`}
                        style={{ ...cellStyle, height: WEEK_ROW_HEIGHT_PX }}
                        title={
                          state === 'extra'
                            ? 'Extra availability'
                            : state === 'available'
                              ? 'Available'
                              : state === 'blocked'
                                ? 'Blocked'
                                : 'Unavailable (admin can still reschedule here)'
                        }
                      />
                    )
                  })}

                  {dayBookings.map((booking) => {
                    const startMin = isoToMinutes(booking.start_time, timeZone)
                    const endParts = isoToZonedParts(booking.end_time, timeZone)
                    let endMin = endParts.startMinutes
                    if (endParts.dateKey > day.dateKey) endMin += 24 * 60
                    if (endParts.dateKey < day.dateKey) endMin = startMin + 60
                    const top = minutesToTopPx(startMin)
                    const height = durationToHeightPx(startMin, endMin)

                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onBookingClick(day.dateKey, booking.id)
                        }}
                        className="absolute left-0.5 right-0.5 z-10 overflow-hidden border border-sage-deep bg-sage px-1 py-0.5 text-left text-[10px] font-medium leading-tight text-white"
                        style={{ top, height: Math.max(height, WEEK_ROW_HEIGHT_PX) }}
                        title={`${booking.student_name} · ${formatTimeLabel(startMin)}`}
                      >
                        <span className="block truncate">{booking.student_name}</span>
                        <span className="block truncate opacity-90">{formatTimeLabel(startMin)}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
