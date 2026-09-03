import { describe, expect, it } from 'vitest'
import { isSlotTakenByBooking, type BookedRange } from './bookingAvailabilityUtils'
import { TUTOR_SCHEDULE_TIMEZONE } from './config'
import { SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import { collectOpenStartIsos, collectTakenStartIsos } from './studentScheduleAvailability'
import { getDateKeyInTimezone, isoToZonedParts, zonedCivilToIso } from './timezoneUtils'

describe('collectOpenStartIsos', () => {
  it('includes date_availability extras on tutor today', () => {
    const now = new Date()
    const todayKey = getDateKeyInTimezone(now, TUTOR_SCHEDULE_TIMEZONE)
    const { startMinutes: nowMinutes } = isoToZonedParts(now.toISOString(), TUTOR_SCHEDULE_TIMEZONE)

    let startMinutes = Math.ceil((nowMinutes + 3 * 60) / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES
    if (startMinutes + SLOT_INTERVAL_MINUTES >= 24 * 60) return

    const schedule = {
      weeklyCells: [],
      blockouts: [],
      dateExtras: [
        { availability_date: todayKey, start_minutes: startMinutes },
        { availability_date: todayKey, start_minutes: startMinutes + SLOT_INTERVAL_MINUTES },
      ],
    }

    const starts = collectOpenStartIsos(
      null,
      schedule,
      [],
      TUTOR_SCHEDULE_TIMEZONE,
      TUTOR_SCHEDULE_TIMEZONE,
      1,
    )

    const expectedIso = zonedCivilToIso(todayKey, startMinutes, TUTOR_SCHEDULE_TIMEZONE)
    expect(starts).toContain(expectedIso)
  })

  it('hides only the start time occupied by another lesson', () => {
    const now = new Date()
    const todayKey = getDateKeyInTimezone(now, TUTOR_SCHEDULE_TIMEZONE)
    const { startMinutes: nowMinutes } = isoToZonedParts(now.toISOString(), TUTOR_SCHEDULE_TIMEZONE)

    const blockStart = Math.ceil((nowMinutes + 2 * 60) / SLOT_INTERVAL_MINUTES) * SLOT_INTERVAL_MINUTES
    if (blockStart + 3 * SLOT_INTERVAL_MINUTES >= 24 * 60) return

    const minutes: number[] = []
    for (let m = blockStart - SLOT_INTERVAL_MINUTES; m <= blockStart + 2 * SLOT_INTERVAL_MINUTES; m += SLOT_INTERVAL_MINUTES) {
      minutes.push(m)
    }

    const schedule = {
      weeklyCells: [],
      blockouts: [],
      dateExtras: minutes.map((start_minutes) => ({ availability_date: todayKey, start_minutes })),
    }

    const takenIso = zonedCivilToIso(todayKey, blockStart, TUTOR_SCHEDULE_TIMEZONE)
    const bookedRanges: BookedRange[] = [
      {
        start_time: takenIso,
        end_time: new Date(new Date(takenIso).getTime() + 60 * 60 * 1000).toISOString(),
        duration_minutes: 25,
      },
    ]

    const open = collectOpenStartIsos(null, schedule, bookedRanges, TUTOR_SCHEDULE_TIMEZONE)
    const taken = collectTakenStartIsos(null, schedule, bookedRanges, TUTOR_SCHEDULE_TIMEZONE)

    expect(isSlotTakenByBooking(takenIso, null, bookedRanges)).toBe(true)
    expect(taken).toContain(takenIso)
    expect(open).not.toContain(takenIso)
    expect(open).toContain(zonedCivilToIso(todayKey, blockStart - SLOT_INTERVAL_MINUTES, TUTOR_SCHEDULE_TIMEZONE))
    expect(open).toContain(zonedCivilToIso(todayKey, blockStart + SLOT_INTERVAL_MINUTES, TUTOR_SCHEDULE_TIMEZONE))
  })
})
