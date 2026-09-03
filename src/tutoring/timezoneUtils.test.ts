import { describe, expect, it } from 'vitest'
import {
  addDaysToDateKey,
  dayOfWeekFromDateKey,
  startOfWeekFromDateKey,
  zonedCivilToIso,
} from './timezoneUtils'

describe('civil date keys', () => {
  it('computes weekday without browser-local drift', () => {
    expect(dayOfWeekFromDateKey('2026-09-01')).toBe(2) // Tuesday
    expect(dayOfWeekFromDateKey('2026-08-30')).toBe(0) // Sunday
  })

  it('adds days on the civil calendar', () => {
    expect(addDaysToDateKey('2026-09-01', 1)).toBe('2026-09-02')
    expect(addDaysToDateKey('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('finds Sunday week start from a Tuesday', () => {
    expect(startOfWeekFromDateKey('2026-09-01')).toBe('2026-08-30')
  })
})

describe('zonedCivilToIso', () => {
  it('maps the same instant through LA and Shanghai display', () => {
    const laIso = zonedCivilToIso('2026-09-01', 14 * 60 + 45, 'America/Los_Angeles')
    const shIso = zonedCivilToIso('2026-09-02', 5 * 60 + 45, 'Asia/Shanghai')
    expect(laIso).toBe(shIso)
  })
})
