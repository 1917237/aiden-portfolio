export function isMissingTableError(message: string, tableName: string) {
  return (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('Could not find the table')
  ) && message.includes(tableName)
}

export const DATE_AVAILABILITY_SETUP =
  'Run supabase/05-date-availability.sql in the Supabase SQL Editor to enable extra slots.'
