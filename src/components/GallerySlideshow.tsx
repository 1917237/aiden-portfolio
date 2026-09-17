import { useCallback, useEffect, useState } from 'react'

type GallerySlideshowProps = {
  images: string[]
  altPrefix?: string
}

export function GallerySlideshow({ images, altPrefix = 'Gallery' }: GallerySlideshowProps) {
  const [reduceMotion, setReduceMotion] = useState(false)
  const [index, setIndex] = useState(0)
  const count = images.length

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const go = useCallback(
    (next: number) => {
      if (count === 0) return
      setIndex(((next % count) + count) % count)
    },
    [count],
  )

  useEffect(() => {
    setIndex(0)
  }, [images])

  useEffect(() => {
    if (count < 2) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === 'ArrowRight') go(index + 1)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [count, go, index])

  useEffect(() => {
    if (reduceMotion || count < 2) return
    const id = window.setInterval(() => go(index + 1), 5500)
    return () => window.clearInterval(id)
  }, [reduceMotion, count, go, index])

  if (count === 0) return null

  return (
    <div className="mx-auto mt-6 max-w-xl md:max-w-2xl">
      <div className="relative overflow-hidden border border-line bg-black">
        <div className="relative flex h-[min(52vh,28rem)] w-full items-center justify-center">
          {images.map((src, i) => (
            <img
              key={src}
              src={src}
              alt={`${altPrefix} ${i + 1}`}
              decoding="async"
              loading={i === 0 ? 'eager' : 'lazy'}
              className={`absolute inset-0 m-auto max-h-full max-w-full object-contain transition-opacity duration-500 ${
                i === index ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            />
          ))}
        </div>

        {count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous image"
              className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center border border-line bg-bg/75 text-sm text-ink backdrop-blur-sm transition-colors hover:border-sage hover:text-sage-deep"
              onClick={() => go(index - 1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Next image"
              className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center border border-line bg-bg/75 text-sm text-ink backdrop-blur-sm transition-colors hover:border-sage hover:text-sage-deep"
              onClick={() => go(index + 1)}
            >
              →
            </button>
          </>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="font-mono text-xs tracking-wide text-ink-muted">
            {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                aria-current={i === index}
                className={`h-1.5 w-5 transition-colors ${
                  i === index ? 'bg-sage' : 'bg-line hover:bg-stone'
                }`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
