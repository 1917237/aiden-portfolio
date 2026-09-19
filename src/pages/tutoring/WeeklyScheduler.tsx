import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TUTOR_SCHEDULE_TIMEZONE } from '../../tutoring/config'
import { regenerateBookableSlots } from '../../tutoring/regenerateSlots'
import { cellKey, parseCellKey, WEEKS_AHEAD } from '../../tutoring/scheduleConfig'
import { mapCivilBetweenZones, mapWeeklyCellKeys } from '../../tutoring/scheduleTimezoneMap'
import {
  addDaysToDateKey,
  getDateKeyInTimezone,
  startOfWeekFromDateKey,
} from '../../tutoring/timezoneUtils'
import { useAdminTimezone } from '../../tutoring/AdminTimezoneContext'
import { CollapsibleSection } from './CollapsibleSection'
import { ScheduleHourGrid } from './ScheduleHourGrid'

type Props = {
  onSaved: () => void
  onError: (message: string) => void
  onMessage: (message: string) => void
}

function displayKeyToTutorKey(displayKey: string, displayTimeZone: string) {
  const { dayOfWeek, startMinutes } = parseCellKey(displayKey)
  const weekStart = startOfWeekFromDateKey(getDateKeyInTimezone(new Date(), displayTimeZone))
  const dateKey = addDaysToDateKey(weekStart, dayOfWeek)
  const tutor = mapCivilBetweenZones(
    dateKey,
    startMinutes,
    displayTimeZone,
    TUTOR_SCHEDULE_TIMEZONE,
  )
  return cellKey(tutor.dayOfWeek, tutor.startMinutes)
}

export function WeeklyScheduler({ onSaved, onError, onMessage }: Props) {
  const { timeZone } = useAdminTimezone()
  /** Canonical weekly cells in the tutor schedule timezone. */
  const [tutorKeys, setTutorKeys] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const paintRef = useRef<boolean | null>(null)
  const draggingRef = useRef(false)

  const selected = useMemo(
    () => mapWeeklyCellKeys(tutorKeys, TUTOR_SCHEDULE_TIMEZONE, timeZone),
    [timeZone, tutorKeys],
  )

  const loadWeekly = useCallback(async () => {
    if (!hasLoaded) setLoading(true)
    const { data, error } = await supabase.from('weekly_availability').select('*')

    if (error) {
      onError(error.message)
      setLoading(false)
      return
    }

    const next = new Set<string>()
    for (const row of data ?? []) {
      next.add(cellKey(row.day_of_week, row.start_minutes))
    }
    setTutorKeys(next)
    setHasLoaded(true)
    setLoading(false)
  }, [hasLoaded, onError])

  useEffect(() => {
    void loadWeekly()
  }, [loadWeekly])

  function toggleCell(displayKey: string, forceOn?: boolean) {
    const tutorKey = displayKeyToTutorKey(displayKey, timeZone)
    setTutorKeys((prev) => {
      const next = new Set(prev)
      const on = forceOn ?? !next.has(tutorKey)
      if (on) next.add(tutorKey)
      else next.delete(tutorKey)
      return next
    })
  }

  function handlePointerDown(key: string) {
    draggingRef.current = true
    const tutorKey = displayKeyToTutorKey(key, timeZone)
    const willSelect = !tutorKeys.has(tutorKey)
    paintRef.current = willSelect
    toggleCell(key, willSelect)
  }

  function handlePointerEnter(key: string) {
    if (!draggingRef.current || paintRef.current === null) return
    toggleCell(key, paintRef.current)
  }

  function handlePointerUp() {
    draggingRef.current = false
    paintRef.current = null
  }

  async function handleSave() {
    setSaving(true)
    onError('')
    onMessage('')

    const weeklyRows = [...tutorKeys].map((key) => {
      const { dayOfWeek, startMinutes } = parseCellKey(key)
      return { day_of_week: dayOfWeek, start_minutes: startMinutes }
    })

    const { error: deleteWeeklyError } = await supabase
      .from('weekly_availability')
      .delete()
      .gte('day_of_week', 0)

    if (deleteWeeklyError) {
      onError(deleteWeeklyError.message)
      setSaving(false)
      return
    }

    if (weeklyRows.length > 0) {
      const { error: insertWeeklyError } = await supabase
        .from('weekly_availability')
        .insert(weeklyRows)

      if (insertWeeklyError) {
        onError(insertWeeklyError.message)
        setSaving(false)
        return
      }
    }

    try {
      const count = await regenerateBookableSlots()
      onMessage(`Weekly schedule saved. ${count} open slots generated.`)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to generate slots')
    }

    setSaving(false)
  }

  return (
    <CollapsibleSection
      title="Weekly availability"
      description={`8 AM to 12 AM · 15-min blocks · generates open slots for ${WEEKS_AHEAD} weeks. Times use the timezone in the nav bar.`}
      fullHeight
    >
      {loading && !hasLoaded ? (
        <p className="text-ink-muted">Loading weekly schedule…</p>
      ) : (
        <>
          <ScheduleHourGrid
            mode="weekly"
            selected={selected}
            startHour={8}
            endHour={24}
            onPointerDown={handlePointerDown}
            onPointerEnter={handlePointerEnter}
            onPointerUp={handlePointerUp}
          />

          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="bg-sage-deep px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save weekly schedule'}
            </button>
            <button
              type="button"
              onClick={() => setTutorKeys(new Set())}
              className="border border-line px-4 py-2 text-sm font-semibold"
            >
              Clear all
            </button>
          </div>
        </>
      )}
    </CollapsibleSection>
  )
}
