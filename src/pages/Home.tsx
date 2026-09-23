import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { usePortfolio } from '../lib/PortfolioContext'
import { ProjectThumb } from '../components/ProjectThumb'

const letterAnimation = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
}

const nameContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.035, delayChildren: 0.08 },
  },
}

export function Home() {
  const reduceMotion = useReducedMotion()
  const { siteContent, getCurrentProject } = usePortfolio()
  const featured = getCurrentProject()
  const name = siteContent.name

  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <div className="relative mx-auto flex min-h-[100svh] max-w-3xl flex-col items-center justify-center px-5 py-24 text-center md:px-8">
        <div className="w-full">
          <motion.h1
            className="flex flex-wrap justify-center font-display text-[clamp(3.5rem,11vw,6.5rem)] font-semibold leading-[0.98] tracking-tight text-ink"
            variants={reduceMotion ? undefined : nameContainer}
            initial={reduceMotion ? false : 'hidden'}
            animate="visible"
            aria-label={name}
          >
            {name.split('').map((char, index) => (
              <motion.span
                key={`${char}-${index}`}
                variants={reduceMotion ? undefined : letterAnimation}
                className={char === ' ' ? 'w-[0.28em]' : undefined}
              >
                {char === ' ' ? '\u00A0' : char}
              </motion.span>
            ))}
          </motion.h1>

          <motion.p
            className="mt-5 text-xl tracking-tight text-sage-deep md:text-3xl"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: reduceMotion ? 0 : 0.4 }}
          >
            {siteContent.tagline}
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.55 }}
          >
            <Link to="/projects" className="btn-primary">
              Projects
            </Link>
            <Link to="/contact" className="btn-ghost">
              Contact
            </Link>
          </motion.div>

          {featured ? (
            <motion.div
              className="mx-auto mt-10 max-w-sm"
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: reduceMotion ? 0 : 0.78 }}
            >
              <Link
                to={`/projects/${featured.slug}`}
                className="group flex items-center gap-3 border-t border-line pt-5 text-left transition-colors hover:border-sage"
              >
                <div className="media-zoom relative h-12 w-16 shrink-0 overflow-hidden border border-line">
                  <ProjectThumb project={featured} alt="" className="absolute inset-0" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="label-mono text-[0.6rem]">Current</p>
                  <p className="mt-0.5 truncate text-sm font-medium text-ink transition-colors group-hover:text-sage-deep">
                    {featured.title}
                  </p>
                </div>
                <span className="font-mono text-sm text-sage transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
            </motion.div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
