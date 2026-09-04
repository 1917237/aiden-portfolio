/** Must match supabase/48-late-cancel-and-meeting-links.sql */
export const LATE_CANCEL_HOURS = 12

export const LATE_CANCEL_AGREEMENT = `If I cancel within ${LATE_CANCEL_HOURS} hours of class, I won't get those credits back. If it's a real emergency, I'll text Aiden — he can waive it.`

export function isLateCancel(startIso: string, now = new Date()) {
  const start = new Date(startIso).getTime()
  return start < now.getTime() + LATE_CANCEL_HOURS * 60 * 60 * 1000
}
