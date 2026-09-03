import { describe, expect, it } from 'vitest'
import { occupiedMinutesForDuration } from './bookingDurationConfig'
import { generateSlotsFromWeekly } from './generateSlots'

describe('generateSlotsFromWeekly', () => {
  it('uses the shortest lesson occupy window for open slot end_time', () => {
    const slots = generateSlotsFromWeekly(
      [
        { day_of_week: 1, start_minutes: 16 * 60 },
        { day_of_week: 1, start_minutes: 16 * 60 + 15 },
      ],
      [],
      [],
      2,
      'America/Los_Angeles',
    )

    expect(slots.length).toBeGreaterThan(0)
    const slot = slots[0]!
    const startMs = new Date(slot.start_time).getTime()
    const endMs = new Date(slot.end_time).getTime()
    const expectedMinutes = occupiedMinutesForDuration(25)
    expect((endMs - startMs) / 60_000).toBe(expectedMinutes)
  })
})
