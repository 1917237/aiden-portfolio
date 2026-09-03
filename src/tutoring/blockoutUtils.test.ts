import { describe, expect, it } from 'vitest'
import { isClassTimeBlocked } from './blockoutUtils'
import type { Blockout, DateAvailability } from './scheduleTypes'

function blockout(date: string, startMinutes: number | null): Blockout {
  return {
    id: `b-${date}-${startMinutes ?? 'all'}`,
    blockout_date: date,
    start_minutes: startMinutes,
  }
}

function extra(date: string, startMinutes: number): DateAvailability {
  return {
    availability_date: date,
    start_minutes: startMinutes,
  }
}

describe('isClassTimeBlocked', () => {
  const dateKey = '2026-09-10'

  it('returns false when there are no blockouts', () => {
    expect(isClassTimeBlocked(dateKey, 14 * 60, [])).toBe(false)
  })

  it('blocks the whole day when start_minutes is null', () => {
    expect(isClassTimeBlocked(dateKey, 10 * 60, [blockout(dateKey, null)])).toBe(true)
  })

  it('blocks only the matching 15-minute slot', () => {
    const blockouts = [blockout(dateKey, 14 * 60)]
    expect(isClassTimeBlocked(dateKey, 14 * 60, blockouts, 50)).toBe(true)
    expect(isClassTimeBlocked(dateKey, 14 * 60 + 15, blockouts, 50)).toBe(false)
  })

  it('treats date extras as open even on a whole-day blockout', () => {
    const blockouts = [blockout(dateKey, null)]
    const extras = [extra(dateKey, 14 * 60), extra(dateKey, 14 * 60 + 15)]
    expect(isClassTimeBlocked(dateKey, 14 * 60, blockouts, 25, extras)).toBe(false)
  })
})
