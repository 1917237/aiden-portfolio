import { describe, expect, it } from 'vitest'
import { CONFIRM_CLASS_BUFFER_MINUTES, isBookingReadyToConfirm } from './confirmClassUtils'

describe('isBookingReadyToConfirm', () => {
  const endTime = '2026-09-01T20:00:00.000Z'

  it('is not ready more than 10 minutes before class ends', () => {
    const now = new Date('2026-09-01T19:49:00.000Z')
    expect(isBookingReadyToConfirm(endTime, now)).toBe(false)
  })

  it('is ready exactly 10 minutes before class ends', () => {
    const now = new Date('2026-09-01T19:50:00.000Z')
    expect(isBookingReadyToConfirm(endTime, now)).toBe(true)
  })

  it('is ready after class ends', () => {
    const now = new Date('2026-09-01T20:05:00.000Z')
    expect(isBookingReadyToConfirm(endTime, now)).toBe(true)
  })

  it('uses a 10-minute buffer constant', () => {
    expect(CONFIRM_CLASS_BUFFER_MINUTES).toBe(10)
  })
})
