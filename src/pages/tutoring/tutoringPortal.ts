/** Prefer the tutoring shell so design tokens/animations still apply. */
export function getTutoringPortalRoot(): HTMLElement {
  return (
    (typeof document !== 'undefined' &&
      (document.querySelector('.tutoring-app') as HTMLElement | null)) ||
    document.body
  )
}
