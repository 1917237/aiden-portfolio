/** Viewport height for schedule grids (header + page chrome subtracted). */
export const SCHEDULE_GRID_HEIGHT = 'calc(100svh - 11rem)'

export const SCHEDULE_TIME_WIDTH = '5.5rem'

/** Explicit border so grid lines always show (not relying on Tailwind border utilities on buttons). */
export const cellStyle = {
  borderRight: '1px solid #c5cdc0',
  borderBottom: '1px solid #c5cdc0',
} as const

export const outerGridStyle = {
  border: '1px solid #c5cdc0',
} as const
