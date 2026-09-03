export type WeeklyCell = {
  day_of_week: number
  start_minutes: number
}

export type Blockout = {
  id?: string
  blockout_date: string
  start_minutes: number | null
}

export type DateAvailability = {
  availability_date: string
  start_minutes: number
}
