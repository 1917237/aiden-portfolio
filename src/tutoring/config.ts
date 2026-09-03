/** Default class rate in cents ($40). Students can have their own rate in profiles.class_rate_cents. */
export const DEFAULT_CLASS_RATE_CENTS = 4000

/** @deprecated Use student's class_rate_cents from profile */
export const CLASS_COST_CENTS = DEFAULT_CLASS_RATE_CENTS

/**
 * IANA timezone for weekly availability, blockouts, and extra slots in the database.
 * Admin calendars can display in any timezone; times are converted to/from this zone.
 *
 * Change this to match where you actually set tutoring hours (e.g. Asia/Shanghai).
 * Also update public.tutor_schedule_timezone() in supabase/31-tutor-timezone-notifications.sql
 * so notification text stays in the same zone.
 */
export const TUTOR_SCHEDULE_TIMEZONE = 'America/Los_Angeles'
