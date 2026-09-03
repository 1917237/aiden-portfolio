import { describe, expect, it } from 'vitest'
import { isSlotTakenByBooking } from '../bookingAvailabilityUtils'
import { TUTOR_SCHEDULE_TIMEZONE } from '../config'
import { generateSlotsFromWeekly, getDateAvailabilityState } from '../generateSlots'
import { collectOpenStartIsos, collectTakenStartIsos } from '../studentScheduleAvailability'
import { buildSlotsByCell } from '../../pages/tutoring/StudentWhen2MeetGrid'
import { dayOfWeekFromDateKey, getDateKeyInTimezone, isoToZonedParts, zonedCivilToIso } from '../timezoneUtils'
import { integrationSkipReason, loadIntegrationTestEnv } from './testEnv'
import { signInAs } from './testClients'

const env = loadIntegrationTestEnv()
const describeIntegration = env ? describe : describe.skip

if (!env) {
  describe.skip(integrationSkipReason, () => {})
}

function minsToTime(m: number) {
  const h = Math.floor(m / 60)
  const min = m % 60
  const p = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return min === 0 ? `${h12} ${p}` : `${h12}:${String(min).padStart(2, '0')} ${p}`
}

describeIntegration('slot gap diagnostic', () => {
  if (!env) return

  it('reports Sep 1 afternoon slot coverage', async () => {
    const { client } = await signInAs(env, env.adminEmail, env.adminPassword)
    const day = '2026-09-01'

    const [extras, blockouts, weekly, occupied] = await Promise.all([
      client.from('date_availability').select('*').eq('availability_date', day).order('start_minutes'),
      client.from('availability_blockouts').select('*').eq('blockout_date', day).order('start_minutes'),
      client.from('weekly_availability').select('*'),
      client.rpc('list_occupied_booking_ranges'),
    ])

    expect(extras.error).toBeNull()
    expect(blockouts.error).toBeNull()
    expect(weekly.error).toBeNull()
    expect(occupied.error).toBeNull()

    const schedule = {
      weeklyCells: weekly.data ?? [],
      blockouts: blockouts.data ?? [],
      dateExtras: extras.data ?? [],
    }

    const extraMinutes = (extras.data ?? []).map((row) => row.start_minutes as number)
    const gaps: string[] = []
    for (let m = 10 * 60; m <= 16 * 60 + 30; m += 15) {
      if (!extraMinutes.includes(m)) gaps.push(minsToTime(m))
    }

    const dow = dayOfWeekFromDateKey(day)
    const state = getDateAvailabilityState(day, dow, schedule.weeklyCells, schedule.dateExtras, schedule.blockouts)
    const admin245 = state.extras.has(14 * 60 + 45) || state.available.has(14 * 60 + 45)

    const bookedRanges = (occupied.data ?? []).map((row) => ({
      start_time: row.start_time as string,
      end_time: row.end_time as string,
      duration_minutes: row.duration_minutes as number | null,
    }))

    const iso245 = zonedCivilToIso(day, 14 * 60 + 45, TUTOR_SCHEDULE_TIMEZONE)
    const open = collectOpenStartIsos(null, schedule, bookedRanges, TUTOR_SCHEDULE_TIMEZONE)
    const taken = collectTakenStartIsos(null, schedule, bookedRanges, TUTOR_SCHEDULE_TIMEZONE)
    const openShanghai = collectOpenStartIsos(null, schedule, bookedRanges, 'Asia/Shanghai')
    const generated = generateSlotsFromWeekly(
      schedule.weeklyCells,
      schedule.blockouts,
      schedule.dateExtras,
      6,
      TUTOR_SCHEDULE_TIMEZONE,
    )

    const generated245 = generated.some((slot) => slot.start_time === iso245)
    const open245 = open.includes(iso245)
    const taken245 = taken.includes(iso245)
    const shanghai245Cell = openShanghai.filter((iso) => {
      const parts = isoToZonedParts(iso, 'Asia/Shanghai')
      return parts.startMinutes === 14 * 60 + 45
    })

    const laSlots = open.map((iso) => ({ id: `virtual:${iso}`, start_time: iso, end_time: iso, is_booked: false, created_at: '' }))
    const laByCell = buildSlotsByCell(laSlots, TUTOR_SCHEDULE_TIMEZONE)
    const la245Key = `${day}-${14 * 60 + 45}`
    const laCell245 = laByCell.has(la245Key)

    const shSlots = openShanghai.map((iso) => ({ id: `virtual:${iso}`, start_time: iso, end_time: iso, is_booked: false, created_at: '' }))
    const shByCell = buildSlotsByCell(shSlots, 'Asia/Shanghai')
    const tueKey = day
    const laTuesdayAfternoon: string[] = []
    for (let m = 13 * 60; m <= 16 * 60; m += 15) {
      const label = minsToTime(m)
      laTuesdayAfternoon.push(`${label}:${laByCell.has(`${tueKey}-${m}`) ? 'green' : 'white'}`)
    }
    const shanghaiTuesdayAfternoon: string[] = []
    for (let m = 13 * 60; m <= 16 * 60; m += 15) {
      const label = minsToTime(m)
      shanghaiTuesdayAfternoon.push(`${label}:${shByCell.has(`${tueKey}-${m}`) ? 'green' : 'white'}`)
    }
    const wedKey = '2026-09-02'
    const shanghaiWednesdayMorning: string[] = []
    for (let m = 8 * 60; m <= 11 * 60; m += 15) {
      if (shByCell.has(`${wedKey}-${m}`)) shanghaiWednesdayMorning.push(minsToTime(m))
    }

    const { data: profiles } = await client.from('profiles').select('full_name, display_timezone, role').eq('role', 'student')

    const occupiedOnDay = bookedRanges
      .filter((range) => getDateKeyInTimezone(range.start_time, TUTOR_SCHEDULE_TIMEZONE) === day)
      .map((range) => ({
        start: minsToTime(isoToZonedParts(range.start_time, TUTOR_SCHEDULE_TIMEZONE).startMinutes),
        duration: range.duration_minutes,
        blocks245: isSlotTakenByBooking(iso245, null, [range]),
      }))

    // Printed when test fails or with --reporter=verbose; also surfaces in CI logs.
    console.log(
      JSON.stringify(
        {
          day,
          extraRowCount: extraMinutes.length,
          extraGaps10to430: gaps,
          adminShows245Open: admin245,
          generated245,
          open245,
          taken245,
          shanghai245CellCount: shanghai245Cell.length,
          laCell245,
          laTuesdayAfternoon,
          shanghaiTuesdayAfternoon,
          shanghaiWednesdayMorning,
          studentTimezones: (profiles ?? []).map((p) => ({
            name: p.full_name,
            tz: p.display_timezone,
          })),
          blockouts: (blockouts.data ?? []).map((b) =>
            b.start_minutes === null ? 'ALL_DAY' : minsToTime(b.start_minutes as number),
          ),
          occupiedOnDay,
        },
        null,
        2,
      ),
    )

    expect(extraMinutes.length).toBeGreaterThan(0)
  })
})
