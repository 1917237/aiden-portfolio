import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lessonToIcsEvent } from '../../tutoring/calendarIcs'
import type { AvailabilitySlot, Booking } from '../../tutoring/types'
import { CalendarSyncMenu } from './CalendarSyncMenu'
import { StudentLessonsCalendar, type StudentLesson } from './StudentLessonsCalendar'

type BookingWithSlot = Booking & {
  availability_slots: Pick<AvailabilitySlot, 'start_time' | 'end_time'> | null
}

type Props = {
  studentId: string
  timeZone: string
  refreshKey?: number
  onSelectLesson: (lesson: StudentLesson) => void
}

export function StudentClassesSection({
  studentId,
  timeZone,
  refreshKey = 0,
  onSelectLesson,
}: Props) {
  const [lessons, setLessons] = useState<BookingWithSlot[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setDataLoading(true)
    setError(null)

    const { data, error: loadError } = await supabase
      .from('bookings')
      .select('*, availability_slots(start_time, end_time)')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setDataLoading(false)
      return
    }

    setLessons((data ?? []) as BookingWithSlot[])
    setDataLoading(false)
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const studentLessons = useMemo(
    () =>
      lessons
        .filter(
          (booking) => booking.availability_slots?.start_time && booking.availability_slots?.end_time,
        )
        .map((booking) => {
          const start = booking.availability_slots!.start_time
          const duration = booking.duration_minutes ?? 50
          return {
            id: booking.id,
            status: booking.status,
            duration_minutes: duration,
            start_time: start,
            end_time: new Date(new Date(start).getTime() + duration * 60_000).toISOString(),
            meeting_url: booking.meeting_url?.trim() || null,
          }
        }),
    [lessons],
  )

  const icsDownloadEvents = useMemo(
    () =>
      studentLessons
        .filter((lesson) => lesson.status === 'booked')
        .map((lesson) => lessonToIcsEvent(lesson)),
    [studentLessons],
  )

  return (
    <section className="mt-10 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            My classes
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Click a lesson to cancel or reschedule. Sync to your phone calendar below.
          </p>
        </div>
        <CalendarSyncMenu downloadEvents={icsDownloadEvents} />
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
      {dataLoading ? (
        <p className="mt-6 text-ink-muted">Loading your classes…</p>
      ) : (
        <StudentLessonsCalendar
          lessons={studentLessons}
          timeZone={timeZone}
          onSelectLesson={onSelectLesson}
        />
      )}
    </section>
  )
}
