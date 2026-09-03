export function formatCredits(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

export function formatSignedCredits(cents: number) {
  const amount = (Math.abs(cents) / 100).toFixed(2)
  return cents < 0 ? `-$${amount}` : `$${amount}`
}

export function creditBalanceTone(cents: number): 'positive' | 'negative' | 'neutral' {
  if (cents > 0) return 'positive'
  if (cents < 0) return 'negative'
  return 'neutral'
}

export function formatSlotRange(start: string, end: string, timeZone?: string) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const zone = timeZone ? { timeZone } : undefined
  const date = startDate.toLocaleDateString(undefined, {
    ...zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const startTime = startDate.toLocaleTimeString(undefined, {
    ...zone,
    hour: 'numeric',
    minute: '2-digit',
  })
  const endTime = endDate.toLocaleTimeString(undefined, {
    ...zone,
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${date} · ${startTime} – ${endTime}`
}

export function toDatetimeLocalValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
