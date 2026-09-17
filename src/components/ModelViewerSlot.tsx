import { useEffect, useRef } from 'react'
import { Placeholder } from './Placeholder'

type ModelViewerSlotProps = {
  src?: string
  alt?: string
  className?: string
  /** When false, auto-rotates and ignores pointer (good for cards). Default true. */
  interactive?: boolean
}

export function ModelViewerSlot({
  src,
  alt = '3D model',
  className = '',
  interactive = true,
}: ModelViewerSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!src) return

    let cancelled = false

    void import('@google/model-viewer').then(() => {
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

    return () => {
      cancelled = true
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [src, alt, interactive])

  if (!src) {
    return (
      <Placeholder
        label="3D model viewer"
        hint="Export a .glb from Fusion/Onshape and set the model path in projects.json. Visitors will be able to orbit, zoom, and pan."
        aspect="video"
        className={`min-h-80 ${className}`.trim()}
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
