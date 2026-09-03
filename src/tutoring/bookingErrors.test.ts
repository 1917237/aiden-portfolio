import { describe, expect, it } from 'vitest'
import {
  BOOKING_CONTACT_HINT,
  extractErrorMessage,
  formatBookingError,
  formatBookingRpcError,
} from './bookingErrors'

describe('extractErrorMessage', () => {
  it('reads PostgREST-style objects', () => {
    expect(
      extractErrorMessage({
        message: 'function is not unique',
        details: 'detail',
        code: '42725',
      }),
    ).toBe('function is not unique')
  })

  it('returns empty for unknown values', () => {
    expect(extractErrorMessage(null)).toBe('')
    expect(extractErrorMessage({})).toBe('')
  })
})

describe('formatBookingRpcError', () => {
  it('maps slot conflicts', () => {
    expect(formatBookingRpcError('Slot is already booked')).toContain('another student')
  })

  it('adds contact hint for ambiguous database functions', () => {
    expect(formatBookingRpcError('function public.hold_credits_for_lesson(uuid, integer, boolean) is not unique')).toContain(
      BOOKING_CONTACT_HINT,
    )
  })

  it('adds contact hint when message is empty', () => {
    expect(formatBookingRpcError('')).toContain(BOOKING_CONTACT_HINT)
  })
})

describe('formatBookingError', () => {
  it('formats non-Error throws', () => {
    expect(
      formatBookingError({
        message: 'function is not unique',
      }),
    ).toContain(BOOKING_CONTACT_HINT)
  })
})
