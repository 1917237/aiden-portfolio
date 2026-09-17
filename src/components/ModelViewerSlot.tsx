import { useEffect, useRef, useState } from 'react'
import { Placeholder } from './Placeholder'

type ModelViewerSlotProps = {
  src?: string
  alt?: string
  className?: string
  /** When false, auto-rotates and ignores pointer (good for cards). Default true. */
  interactive?: boolean
}

const MODEL_VIEWER_CDN =
  'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js'

let modelViewerLoader: Promise<void> | null = null

function loadModelViewer(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (customElements.get('model-viewer')) return Promise.resolve()
  if (modelViewerLoader) return modelViewerLoader

  modelViewerLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-model-viewer]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('model-viewer failed to load')))
      return
    }
    const script = document.createElement('script')
    script.type = 'module'
    script.src = MODEL_VIEWER_CDN
    script.dataset.modelViewer = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('model-viewer failed to load'))
    document.head.appendChild(script)
  })

  return modelViewerLoader
}

export function ModelViewerSlot({
  src,
  alt = '3D model',
  className = '',
  interactive = true,
}: ModelViewerSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src) return

    let cancelled = false

    void loadModelViewer()
      .then(() => {
        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = ''
        const viewer = document.createElement('model-viewer')
        viewer.setAttribute('src', src)
        viewer.setAttribute('alt', alt)
        viewer.setAttribute('environment-image', 'neutral')
        viewer.setAttribute('tone-mapping', 'commerce')
        viewer.setAttribute('shadow-intensity', '1.2')
        viewer.setAttribute('shadow-softness', '0.5')
        viewer.setAttribute('exposure', '0.55')
        if (interactive) {
          viewer.setAttribute('camera-controls', '')
          viewer.setAttribute('touch-action', 'pan-y')
        } else {
          viewer.setAttribute('auto-rotate', '')
          viewer.setAttribute('rotation-per-second', '18deg')
          viewer.style.pointerEvents = 'none'
        }
        viewer.style.width = '100%'
        viewer.style.height = '100%'
        viewer.style.backgroundColor = '#000000'
        viewer.style.filter = 'brightness(0.68) contrast(1.25) saturate(1.7)'
        containerRef.current.appendChild(viewer)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [src, alt, interactive])

  if (!src || failed) {
    return (
      <Placeholder
        label="3D model viewer"
        hint={
          failed
            ? 'Could not load the 3D viewer.'
            : 'Export a .glb from Fusion/Onshape and set the model path.'
        }
        aspect="video"
        className={
          interactive
            ? `min-h-80 ${className}`.trim()
            : `h-full min-h-0 border-0 ${className}`.trim()
        }
      />
    )
  }

  return (
    <div
      ref={containerRef}
      className={
        interactive
          ? `aspect-video min-h-80 w-full overflow-hidden border border-line bg-black ${className}`.trim()
          : `h-full min-h-0 w-full overflow-hidden bg-black ${className}`.trim()
      }
    />
  )
}
