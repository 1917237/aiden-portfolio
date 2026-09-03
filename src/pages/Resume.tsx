import { useState } from 'react'
import { hasValue, siteContent } from '../lib/content'

const MIN_ZOOM = 75
const MAX_ZOOM = 200
const ZOOM_STEP = 25

export function Resume() {
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
    <div className="mx-auto flex max-w-6xl flex-col px-5 py-14 md:px-8 md:py-20">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium tracking-wide text-sage uppercase">Resume</p>
          <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">
            {siteContent.name}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            className="border border-line bg-bg-elevated px-3 py-2 text-sm font-semibold text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="min-w-16 border border-line bg-bg-elevated px-3 py-2 text-sm font-semibold text-ink transition hover:bg-white"
            aria-label="Reset zoom"
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            className="border border-line bg-bg-elevated px-3 py-2 text-sm font-semibold text-ink transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
          <a
            href={resumeUrl}
            download="Aiden-Luo-resume.pdf"
            className="bg-sage-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink"
          >
            Download PDF
          </a>
        </div>
      </div>

      <div className="mt-8 w-full overflow-x-auto">
        <div
          className="mx-auto border border-line bg-white shadow-sm"
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
