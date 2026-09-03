import { describe, expect, it } from 'vitest'
import {
  addWeeksToIso,
  bookedOccupiedEndMs,
  isSlotTakenByBooking,
  type BookedRange,
} from './bookingAvailabilityUtils'

describe('bookedOccupiedEndMs', () => {
  it('uses duration-based occupy window when duration is set', () => {
    const range: BookedRange = {
      start_time: '2026-09-01T20:00:00.000Z',
      end_time: '2026-09-01T21:00:00.000Z',
      duration_minutes: 50,
    }
    const endMs = bookedOccupiedEndMs(range)
    const startMs = new Date(range.start_time).getTime()
    expect(endMs - startMs).toBe(60 * 60 * 1000)
  })
})

describe('isSlotTakenByBooking', () => {
  const booked: BookedRange[] = [
    {
      start_time: '2026-09-01T20:00:00.000Z',
      end_time: '2026-09-01T21:00:00.000Z',
      duration_minutes: 50,
    },
  ]

  it('hides a start time inside the occupied window', () => {
    expect(
      isSlotTakenByBooking('2026-09-01T20:15:00.000Z', null, booked),
    ).toBe(true)
  })

  it('allows booking exactly when the occupied window ends', () => {
    expect(
      isSlotTakenByBooking('2026-09-01T21:00:00.000Z', null, booked),
    ).toBe(false)
  })
})

describe('addWeeksToIso', () => {
  it('keeps the same wall-clock time across a DST spring-forward week', () => {
    const before = '2026-03-01T22:00:00.000Z' // 2:00 PM PT (PST)
    const after = addWeeksToIso(before, 1, 'America/Los_Angeles')
    const afterDate = new Date(after)
    const parts = afterDate.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    expect(parts).toContain('2:00 PM')
  })

  it('returns the same instant when adding zero weeks', () => {
    const iso = '2026-09-01T20:00:00.000Z'
    expect(addWeeksToIso(iso, 0, 'America/Los_Angeles')).toBe(iso)
  })
})
