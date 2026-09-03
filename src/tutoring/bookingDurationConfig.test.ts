import { describe, expect, it } from 'vitest'
import {
  formatDurationLabel,
  lessonCostCents,
  occupiedMinutesForDuration,
  resolveBookingDuration,
} from './bookingDurationConfig'

describe('lessonCostCents', () => {
  const rate = 4000

  it('charges half for a 25-minute lesson', () => {
    expect(lessonCostCents(rate, 25)).toBe(2000)
  })

  it('charges full rate for 50 minutes', () => {
    expect(lessonCostCents(rate, 50)).toBe(4000)
  })

  it('charges 1.5x for 80 minutes', () => {
    expect(lessonCostCents(rate, 80)).toBe(6000)
  })

  it('charges 2x for 110 minutes', () => {
    expect(lessonCostCents(rate, 110)).toBe(8000)
  })
})

describe('occupiedMinutesForDuration', () => {
  it('reserves 30 minutes for a 25-minute lesson (lesson + break, rounded)', () => {
    expect(occupiedMinutesForDuration(25)).toBe(30)
  })

  it('reserves 60 minutes for a 50-minute lesson', () => {
    expect(occupiedMinutesForDuration(50)).toBe(60)
  })

  it('reserves 90 minutes for an 80-minute lesson', () => {
    expect(occupiedMinutesForDuration(80)).toBe(90)
  })

  it('reserves 120 minutes for a 110-minute lesson', () => {
    expect(occupiedMinutesForDuration(110)).toBe(120)
  })
})

describe('resolveBookingDuration', () => {
  it('returns stored lesson length when selectable', () => {
    expect(resolveBookingDuration(80)).toBe(80)
  })

  it('falls back to 50 for unknown lengths', () => {
    expect(resolveBookingDuration(60)).toBe(50)
    expect(resolveBookingDuration(null)).toBe(50)
  })
})

describe('formatDurationLabel', () => {
  it('formats short lessons in minutes', () => {
    expect(formatDurationLabel(25)).toBe('25 min')
  })

  it('formats whole hours', () => {
    expect(formatDurationLabel(60)).toBe('1 hour')
    expect(formatDurationLabel(120)).toBe('2 hours')
  })

  it('formats hours and minutes', () => {
    expect(formatDurationLabel(80)).toBe('1 hour 20 min')
  })
})
