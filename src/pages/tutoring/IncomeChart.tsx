import { formatAxisMoney, type ChartPoint } from '../../tutoring/insightsUtils'

type Props = {
  points: ChartPoint[]
}

const WIDTH = 720
const HEIGHT = 220
const PAD = { top: 16, right: 16, bottom: 32, left: 44 }

export function IncomeChart({ points }: Props) {
  const chartWidth = WIDTH - PAD.left - PAD.right
  const chartHeight = HEIGHT - PAD.top - PAD.bottom
  const maxIncome = Math.max(...points.map((point) => point.incomeCents), 1)
  const yMax = niceCeil(maxIncome)

  const yTicks = [0, yMax * 0.5, yMax]
  const xStep = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth

  const coords = points.map((point, index) => {
    const x = PAD.left + index * xStep
    const y = PAD.top + chartHeight - (point.incomeCents / yMax) * chartHeight
    return { ...point, x, y }
  })

  const linePath = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')

  const labelIndexes = pickLabelIndexes(points.length)

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="Income chart">
      {yTicks.map((tick) => {
        const y = PAD.top + chartHeight - (tick / yMax) * chartHeight
        return (
          <g key={tick}>
            <line
              x1={PAD.left}
              y1={y}
              x2={WIDTH - PAD.right}
              y2={y}
              stroke="currentColor"
              className="text-line"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y + 4}
              textAnchor="end"
              className="fill-ink-muted text-[10px]"
            >
              {formatAxisMoney(tick)}
            </text>
          </g>
        )
      })}

      {linePath ? (
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          className="text-sage-deep"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {coords.map((point) => (
        <circle
          key={point.key}
          cx={point.x}
          cy={point.y}
          r="4"
          className="fill-sage-deep stroke-white"
          strokeWidth="2"
        />
      ))}

      {labelIndexes.map((index) => {
        const point = coords[index]
        if (!point?.label) return null
        return (
          <text
            key={`${point.key}-label`}
            x={point.x}
            y={HEIGHT - 8}
            textAnchor="middle"
            className="fill-ink-muted text-[10px]"
          >
            {point.label}
          </text>
        )
      })}
    </svg>
  )
}

function niceCeil(value: number) {
  if (value <= 0) return 10000
  const dollars = value / 100
  const magnitude = 10 ** Math.floor(Math.log10(dollars))
  const normalized = dollars / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude * 100
}

function pickLabelIndexes(length: number) {
  if (length <= 7) return Array.from({ length }, (_, index) => index)
  if (length <= 12) return Array.from({ length }, (_, index) => index)
  const indexes = [0]
  const step = Math.max(1, Math.floor(length / 6))
  for (let i = step; i < length - 1; i += step) indexes.push(i)
  indexes.push(length - 1)
  return indexes
}
