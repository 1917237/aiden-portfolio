import { MeshGradient } from '@paper-design/shaders-react'
import { useEffect, useState } from 'react'

/**
 * Paper MeshGradient ambient field — same idea as the shader-hero demo,
 * tuned to the forest-dark portfolio palette (not B&W SaaS chrome).
 */
export function AmbientBackground() {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const speedA = reduceMotion ? 0 : 0.22
  const speedB = reduceMotion ? 0 : 0.12

  return (
    <div className="ambient-bg" aria-hidden>
      <MeshGradient
        className="ambient-bg__shader"
        colors={['#050706', '#14171c', '#1c2420', '#2a3530', '#3a4f44']}
        speed={speedA}
        distortion={0.8}
        swirl={0.32}
        grainMixer={0.15}
        grainOverlay={0.14}
      />
      <MeshGradient
        className="ambient-bg__shader ambient-bg__shader--soft"
        colors={['#0a0c0e', '#24382e', '#4a6b58', '#1a1f1c']}
        speed={speedB}
        distortion={0.9}
        swirl={0.42}
        grainMixer={0.18}
        grainOverlay={0.08}
      />
      <div className="ambient-bg__veil" />
    </div>
  )
}
