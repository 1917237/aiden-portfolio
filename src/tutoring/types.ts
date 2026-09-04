export type AvailabilitySlot = {
  id: string
  start_time: string
  end_time: string
  is_booked: boolean
  created_at: string
}

export type Booking = {
  id: string
  student_id: string
  slot_id: string
  status: 'booked' | 'completed' | 'cancelled'
  charged_cents: number | null
  duration_minutes: number
  pay_later: boolean
  series_id: string | null
  meeting_url?: string | null
  created_at: string
}

export type BookingWithDetails = Booking & {
  availability_slots: AvailabilitySlot
  profiles: { full_name: string; class_rate_cents?: number }
}

export type StudentProfile = {
  id: string
  full_name: string
  credit_balance_cents: number
  class_rate_cents: number
}
