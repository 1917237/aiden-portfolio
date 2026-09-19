import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { integrationSkipReason, loadIntegrationTestEnv } from './testEnv'
import { signInAs, uniqueFutureSlotWindow } from './testClients'

const env = loadIntegrationTestEnv()
const describeIntegration = env ? describe : describe.skip

describeIntegration('booking flow (Supabase)', () => {
  if (!env) return

  let studentId = ''
  let originalCredits = 0
  let classRateCents = 4000
  let slotId: string | null = null
  let bookingId: string | null = null

  beforeAll(async () => {
    const { client: student, userId } = await signInAs(
      env,
      env.studentEmail,
      env.studentPassword,
    )
    studentId = userId

    const { data: profile, error } = await student
      .from('profiles')
      .select('credit_balance_cents, class_rate_cents, role')
      .eq('id', studentId)
      .single()

    if (error || !profile) {
      throw new Error(`Student profile not found: ${error?.message ?? 'missing row'}`)
    }
    if (profile.role !== 'student') {
      throw new Error('INTEGRATION_TEST_STUDENT_EMAIL must be a student account')
    }

    originalCredits = profile.credit_balance_cents
    classRateCents = profile.class_rate_cents ?? 4000

    const { client: admin } = await signInAs(env, env.adminEmail, env.adminPassword)
    const { error: creditError } = await admin
      .from('profiles')
      .update({ credit_balance_cents: 10_000 })
      .eq('id', studentId)

    if (creditError) {
      throw new Error(`Admin could not set test credits: ${creditError.message}`)
    }
  })

  afterAll(async () => {
    const { client: admin } = await signInAs(env, env.adminEmail, env.adminPassword)

    if (bookingId) {
      const { data: booking } = await admin
        .from('bookings')
        .select('status')
        .eq('id', bookingId)
        .maybeSingle()

      if (booking?.status === 'booked') {
        await admin.rpc('cancel_booking', { p_booking_id: bookingId, p_comment: null })
      }
    }

    if (slotId) {
      await admin.from('availability_slots').delete().eq('id', slotId)
    }

    if (studentId) {
      await admin
        .from('profiles')
        .update({ credit_balance_cents: originalCredits })
        .eq('id', studentId)
    }
  })

  it('books a lesson and holds credits', async () => {
    const { client: student } = await signInAs(env, env.studentEmail, env.studentPassword)
    const { startIso, endIso } = uniqueFutureSlotWindow()

    const { data: slot, error: slotError } = await student.rpc('ensure_open_slot', {
      p_start_time: startIso,
      p_end_time: endIso,
    })
    expect(slotError).toBeNull()
    expect(slot?.id).toBeTruthy()
    slotId = slot.id as string

    const { data: bookingIds, error: bookError } = await student.rpc('student_book_lesson', {
      p_slot_id: slotId,
      p_duration_minutes: 50,
      p_weekly: false,
      p_pay_later: false,
    })
    expect(bookError).toBeNull()
    expect(bookingIds?.length).toBe(1)
    bookingId = bookingIds![0] as string

    const { data: profile } = await student
      .from('profiles')
      .select('credit_balance_cents')
      .eq('id', studentId)
      .single()

    expect(profile?.credit_balance_cents).toBe(10_000 - classRateCents)

    const { data: booking } = await student
      .from('bookings')
      .select('status, charged_cents')
      .eq('id', bookingId)
      .single()

    expect(booking?.status).toBe('booked')
    expect(booking?.charged_cents).toBe(classRateCents)
  })

  it('cancels with a tutor note and refunds credits', async () => {
    expect(bookingId).toBeTruthy()

    const note = 'Integration test. sorry, rescheduling soon.'
    const { client: admin } = await signInAs(env, env.adminEmail, env.adminPassword)

    const { error: cancelError } = await admin.rpc('cancel_booking', {
      p_booking_id: bookingId,
      p_comment: note,
    })
    expect(cancelError).toBeNull()

    const { client: student } = await signInAs(env, env.studentEmail, env.studentPassword)

    const { data: profile } = await student
      .from('profiles')
      .select('credit_balance_cents')
      .eq('id', studentId)
      .single()

    expect(profile?.credit_balance_cents).toBe(10_000)

    const { data: booking } = await student
      .from('bookings')
      .select('status, charged_cents')
      .eq('id', bookingId)
      .single()

    expect(booking?.status).toBe('cancelled')
    expect(booking?.charged_cents).toBeNull()

    const { data: notifications } = await student
      .from('notifications')
      .select('title, body, kind')
      .eq('kind', 'class_cancelled')
      .order('created_at', { ascending: false })
      .limit(1)

    expect(notifications?.[0]?.title).toBe('Class cancelled')
    expect(notifications?.[0]?.body).toContain(note)
  })
})

if (!env) {
  describe('booking flow (Supabase)', () => {
    it.skip(integrationSkipReason, () => {})
  })
}
