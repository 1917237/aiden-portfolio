import { describe, expect, it } from 'vitest'
import { LATE_CANCEL_HOURS, isLateCancel } from './lateCancelPolicy'

describe('isLateCancel', () => {
  it('is late when class starts in under 12 hours', () => {
    const now = new Date('2026-09-03T12:00:00Z')
    const start = new Date(now.getTime() + 11 * 60 * 60 * 1000).toISOString()
    expect(isLateCancel(start, now)).toBe(true)
  })

  it('is not late at exactly 12 hours or more', () => {
    const now = new Date('2026-09-03T12:00:00Z')
    const start = new Date(now.getTime() + LATE_CANCEL_HOURS * 60 * 60 * 1000).toISOString()
    expect(isLateCancel(start, now)).toBe(false)
  })
})
