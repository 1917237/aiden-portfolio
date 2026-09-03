import { addDays, formatDateKey } from './calendarUtils'
import { regenerateBookableSlots } from './regenerateSlots'
import { supabase } from '../lib/supabase'

const DEMO_STUDENT_NAMES = ['Alex Chen', 'Jordan Lee', 'Sam Patel'] as const
const DEMO_EMAIL_PREFIXES = ['demo-alex', 'demo-jordan', 'demo-sam'] as const
const DEMO_BOOKING_OFFSETS = [1, 4, 6, 7, 8, 10]
const DEMO_BOOKING_HOURS = [16, 17, 18]

type StudentRow = {
  id: string
  full_name: string
  credit_balance_cents: number
}

function isDemoStudent(fullName: string) {
  return DEMO_STUDENT_NAMES.includes(fullName as (typeof DEMO_STUDENT_NAMES)[number])
}

function isDemoEmailName(fullName: string) {
  return DEMO_EMAIL_PREFIXES.some((prefix) => fullName.toLowerCase().startsWith(prefix))
}

export type SeedDemoResult = {
  studentsUsed: string[]
  bookingsCreated: number
  blockoutsCreated: number
  message: string
}

function localSlotTimes(dateKey: string, hour: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const start = new Date(year, month - 1, day, hour, 0, 0, 0)
  const end = new Date(start)
  end.setMinutes(end.getMinutes() + 60)
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() }
}

async function ensureOpenSlot(dateKey: string, hour: number): Promise<string | null> {
  const { start, startIso, endIso } = localSlotTimes(dateKey, hour)
  if (start <= new Date()) return null

  const { data: existing, error: existingError } = await supabase
    .from('availability_slots')
    .select('id, is_booked')
    .eq('start_time', startIso)
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.is_booked) return null
  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('availability_slots')
    .insert({ start_time: startIso, end_time: endIso, is_booked: false })
    .select('id')
    .single()

  if (error) throw error
  return data.id as string
}

async function bookSlotForStudent(studentId: string, slotId: string): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from('bookings')
    .select('id')
    .eq('slot_id', slotId)
    .eq('status', 'booked')
    .maybeSingle()

  if (existingError) throw existingError
  if (existing?.id) return false

  const { error } = await supabase.rpc('admin_book_slot', {
    p_student_id: studentId,
    p_slot_id: slotId,
  })

  if (error) {
    if (error.message.includes('Could not find the function')) {
      throw new Error('Run supabase/06-booking-actions.sql in the SQL Editor, then try again.')
    }
    throw error
  }

  return true
}

export async function seedDemoCalendarData(): Promise<SeedDemoResult> {
  const { data: students, error: studentsError } = await supabase
    .from('profiles')
    .select('id, full_name, credit_balance_cents')
    .eq('role', 'student')
    .order('full_name')

  if (studentsError) throw studentsError

  const demoStudents = (students ?? []).filter(
    (s) => isDemoStudent(s.full_name) || isDemoEmailName(s.full_name),
  )
  const fallbackStudents = (students ?? []).slice(0, 3)
  const targets: StudentRow[] = demoStudents.length > 0 ? demoStudents : fallbackStudents

  if (targets.length === 0) {
    throw new Error(
      'No student accounts yet. In Supabase → Authentication → Users, create demo-alex@example.com, demo-jordan@example.com, and demo-sam@example.com. Then try again.',
    )
  }

  for (const student of targets) {
    if (student.credit_balance_cents < 4000) {
      const { error } = await supabase.rpc('add_student_credits', {
        p_student_id: student.id,
        p_amount_cents: 12000,
        p_note: 'Demo credits',
      })
      if (error && !error.message.includes('Could not find the function')) {
        throw error
      }
    }
  }

  const { count: weeklyCount } = await supabase
    .from('weekly_availability')
    .select('*', { count: 'exact', head: true })

  if (!weeklyCount) {
    const weeklyRows = []
    for (let day = 1; day <= 5; day++) {
      for (let minutes = 16 * 60; minutes < 20 * 60; minutes += 60) {
        weeklyRows.push({ day_of_week: day, start_minutes: minutes })
      }
    }
    const { error } = await supabase.from('weekly_availability').insert(weeklyRows)
    if (error) throw error
  }

  const today = new Date()
  const base = formatDateKey(today)

  const blockoutDates = [base, addDays(base, 2), addDays(base, 5)]
  const partialBlock = { blockout_date: addDays(base, 3), start_minutes: 17 * 60 }

  const { error: blockError } = await supabase.from('availability_blockouts').insert([
    { blockout_date: blockoutDates[0], start_minutes: null },
    { blockout_date: blockoutDates[1], start_minutes: null },
    partialBlock,
  ])

  if (
    blockError &&
    !blockError.message.includes('duplicate') &&
    !blockError.message.includes('unique')
  ) {
    throw blockError
  }

  await regenerateBookableSlots()

  let bookingsCreated = 0
  let slotIndex = 0

  for (const offset of DEMO_BOOKING_OFFSETS) {
    const dateKey = addDays(base, offset)
    for (const hour of DEMO_BOOKING_HOURS) {
      if (slotIndex >= targets.length * 2) break

      const slotId = await ensureOpenSlot(dateKey, hour)
      if (!slotId) continue

      const student = targets[slotIndex % targets.length]
      const booked = await bookSlotForStudent(student.id, slotId)
      if (booked) {
        bookingsCreated += 1
        slotIndex += 1
      }
    }
  }

  const studentsUsed = targets.map((s) => s.full_name)

  if (bookingsCreated === 0) {
    throw new Error(
      'Could not create demo classes. Run supabase/06-booking-actions.sql in Supabase, then click Load demo data again.',
    )
  }

  return {
    studentsUsed,
    bookingsCreated,
    blockoutsCreated: 3,
    message: `Added ${bookingsCreated} demo classes for ${studentsUsed.join(', ')}. Check the next 2 weeks on the calendar.`,
  }
}
