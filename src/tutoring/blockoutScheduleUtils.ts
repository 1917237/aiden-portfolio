import { SLOT_INTERVAL_MINUTES } from './scheduleConfig'
import type { Blockout } from './scheduleTypes'

function blockoutDateKey(blockout: Blockout) {
  return String(blockout.blockout_date).slice(0, 10)
}

export type ContiguousBlock =
  | {
      kind: 'whole-day'
      dateKey: string
      ids: string[]
    }
  | {
      kind: 'partial'
      dateKey: string
      startMinutes: number
      endMinutes: number
      ids: string[]
    }

export function findContiguousBlock(
  dateKey: string,
  startMinutes: number,
  blockouts: Blockout[],
): ContiguousBlock | null {
  const dayBlockouts = blockouts.filter((b) => blockoutDateKey(b) === dateKey)

  const wholeDay = dayBlockouts.filter((b) => b.start_minutes === null && b.id)
  if (wholeDay.length > 0) {
    return {
      kind: 'whole-day',
      dateKey,
      ids: wholeDay.map((b) => b.id as string),
    }
  }

  const partialMinutes = new Set(
    dayBlockouts
      .filter((b) => b.start_minutes !== null)
      .map((b) => b.start_minutes as number),
  )

  if (!partialMinutes.has(startMinutes)) return null

  let rangeStart = startMinutes
  let rangeEnd = startMinutes

  while (partialMinutes.has(rangeStart - SLOT_INTERVAL_MINUTES)) {
    rangeStart -= SLOT_INTERVAL_MINUTES
  }
  while (partialMinutes.has(rangeEnd + SLOT_INTERVAL_MINUTES)) {
    rangeEnd += SLOT_INTERVAL_MINUTES
  }

  const ids = dayBlockouts
    .filter(
      (b) =>
        b.id &&
        b.start_minutes !== null &&
        (b.start_minutes as number) >= rangeStart &&
        (b.start_minutes as number) <= rangeEnd,
    )
    .map((b) => b.id as string)

  return {
    kind: 'partial',
    dateKey,
    startMinutes: rangeStart,
    endMinutes: rangeEnd + SLOT_INTERVAL_MINUTES,
    ids,
  }
}

export function blockoutsInRange(
  startDateKey: string,
  startMinutes: number,
  endDateKey: string,
  endMinutes: number,
  blockouts: Blockout[],
): string[] {
  const ids: string[] = []
  const dates = new Set<string>()
  let current = new Date(`${startDateKey}T12:00:00`)
  const endDate = new Date(`${endDateKey}T12:00:00`)

  while (current <= endDate) {
    const key = [
      current.getFullYear(),
      String(current.getMonth() + 1).padStart(2, '0'),
      String(current.getDate()).padStart(2, '0'),
    ].join('-')
    dates.add(key)
    current.setDate(current.getDate() + 1)
  }

  for (const blockout of blockouts) {
    if (!blockout.id) continue
    const dateKey = blockoutDateKey(blockout)
    if (!dates.has(dateKey)) continue

    if (blockout.start_minutes === null) {
      ids.push(blockout.id)
      continue
    }

    const minute = blockout.start_minutes
    const isStartDay = dateKey === startDateKey
    const isEndDay = dateKey === endDateKey

    if (isStartDay && isEndDay) {
      if (minute >= startMinutes && minute < endMinutes) ids.push(blockout.id)
    } else if (isStartDay) {
      if (minute >= startMinutes) ids.push(blockout.id)
    } else if (isEndDay) {
      if (minute < endMinutes) ids.push(blockout.id)
    } else {
      ids.push(blockout.id)
    }
  }

  return [...new Set(ids)]
}
