import { useState } from 'react'
import { usePortfolio } from '../lib/PortfolioContext'

const MIN_ZOOM = 75
const MAX_ZOOM = 200
const ZOOM_STEP = 25

export function Resume() {
  const { siteContent, hasValue } = usePortfolio()
  const [zoom, setZoom] = useState(100)
  const resumeUrl = hasValue(siteContent.links.resume)
    ? siteContent.links.resume.trim()
    : '/Aiden-Luo-resume.pdf'

  const scale = zoom / 100

  function zoomIn() {
    setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))
  }

  function zoomOut() {
    setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))
  }

  function resetZoom() {
    setZoom(100)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col px-5 py-14 md:px-8 md:py-20">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
            Resume
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="btn-ghost !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="btn-ghost min-w-16 !px-3 !py-2"
            aria-label="Reset zoom"
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="btn-ghost !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          <a href={resumeUrl} download="Aiden-Luo-resume.pdf" className="btn-primary">
            Download PDF
          </a>
        </div>
      </div>

      <div className="mt-10 w-full overflow-x-auto border border-line bg-bg-elevated p-2">
        <div
          className="mx-auto bg-white"
          style={{
            width: `${100 * scale}%`,
            aspectRatio: '8.5 / 11',
          }}
        >
          <iframe
            title="Aiden Luo resume"
            src={`${resumeUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  )
}
