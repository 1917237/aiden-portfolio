/** Minutes before class end when admin can confirm or cancel. */
export const CONFIRM_CLASS_BUFFER_MINUTES = 10

export function isBookingReadyToConfirm(endTimeIso: string, now = new Date()) {
  const availableAt = new Date(endTimeIso)
  availableAt.setMinutes(availableAt.getMinutes() - CONFIRM_CLASS_BUFFER_MINUTES)
  return now >= availableAt
}
