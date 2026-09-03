import { describe, expect, it } from 'vitest'
import {
  centsToLessonCredits,
  formatLessonCredits,
  lessonCreditsForDuration,
  lessonCreditsToCents,
} from './lessonCredits'

describe('lessonCredits', () => {
  const rate = 4000

  it('converts balance cents to credits', () => {
    expect(centsToLessonCredits(8000, rate)).toBe(2)
    expect(centsToLessonCredits(2000, rate)).toBe(0.5)
  })

  it('converts credits back to cents', () => {
    expect(lessonCreditsToCents(2, rate)).toBe(8000)
    expect(lessonCreditsToCents(0.5, rate)).toBe(2000)
  })

  it('maps lesson duration to credit cost', () => {
    expect(lessonCreditsForDuration(50)).toBe(1)
    expect(lessonCreditsForDuration(25)).toBe(0.5)
    expect(lessonCreditsForDuration(80)).toBe(1.5)
  })

  it('formats credit labels', () => {
    expect(formatLessonCredits(1)).toBe('1 credit')
    expect(formatLessonCredits(2)).toBe('2 credits')
    expect(formatLessonCredits(0.5)).toBe('0.5 credits')
    expect(formatLessonCredits(-1)).toBe('-1 credit')
  })
})
