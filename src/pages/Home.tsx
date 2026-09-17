import { Link } from 'react-router-dom'
import { usePortfolio } from '../lib/PortfolioContext'
import { ProjectThumb } from '../components/ProjectThumb'

export function Home() {
  const { siteContent, getCurrentProject } = usePortfolio()
  const featured = getCurrentProject()
  const name = siteContent.name

  return (
    <section className="relative min-h-[100svh] overflow-hidden">
      <div className="relative mx-auto flex min-h-[100svh] max-w-3xl flex-col items-center justify-center px-5 py-24 text-center md:px-8">
        <div className="w-full">
          <h1
            className="hero-enter flex flex-wrap justify-center font-display text-[clamp(3.5rem,11vw,6.5rem)] font-semibold leading-[0.98] tracking-tight text-ink"
            aria-label={name}
          >
            {name.split('').map((char, index) => (
              <span key={`${char}-${index}`} className={char === ' ' ? 'w-[0.28em]' : undefined}>
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
          </h1>

          <p className="hero-enter hero-enter-delay-1 mt-5 text-xl tracking-tight text-sage-deep md:text-3xl">
            {siteContent.tagline}
          </p>

          <p className="hero-enter hero-enter-delay-2 mx-auto mt-4 max-w-md text-base leading-relaxed text-ink-muted md:text-lg">
            {siteContent.home.supporting}
          </p>

          <div className="hero-enter hero-enter-delay-3 mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/projects" className="btn-primary">
              Projects
            </Link>
            <Link to="/contact" className="btn-ghost">
              Contact
            </Link>
          </div>

          {featured ? (
            <div className="hero-enter hero-enter-delay-3 mx-auto mt-10 max-w-sm">
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
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
