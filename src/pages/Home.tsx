import { Link } from 'react-router-dom'
import { CurrentProject } from '../components/CurrentProject'
import { Placeholder } from '../components/Placeholder'
import { Reveal } from '../components/Reveal'
import { getCurrentProject, hasValue, siteContent } from '../lib/content'

export function Home() {
  const current = getCurrentProject()

  return (
    <div>
      <section className="relative overflow-hidden">
        {hasValue(siteContent.home.heroImage) ? (
          <img
            src={siteContent.home.heroImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,#d7e0d6_0%,#c5d5df_48%,#e8ebe4_100%)]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(28,36,28,0.18)_0%,rgba(28,36,28,0.45)_100%)]" />
        <div className="relative mx-auto flex min-h-[78vh] max-w-6xl flex-col justify-end px-5 pb-16 pt-28 md:px-8 md:pb-20">
          <Reveal immediate>
            <p className="font-display text-5xl font-semibold tracking-tight text-white md:text-7xl">
              {siteContent.name}
            </p>
            <h1 className="mt-4 max-w-2xl text-balance text-2xl font-medium text-white/95 md:text-3xl">
              {siteContent.tagline}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/85">
              {siteContent.home.supporting ||
                'Add a short supporting line in src/content/site.json.'}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/projects"
                className="bg-bg-elevated px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white"
              >
                View projects
              </Link>
              <Link
                to="/contact"
                className="border border-white/70 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Contact
              </Link>
            </div>
            {!hasValue(siteContent.home.heroImage) ? (
              <p className="mt-8 text-sm text-white/70">
                Hero image placeholder — set <code>home.heroImage</code> in{' '}
                <code>site.json</code> (full-bleed photo works best).
              </p>
            ) : null}
          </Reveal>
        </div>
      </section>

      {current ? (
        <Reveal>
          <CurrentProject project={current} />
        </Reveal>
      ) : null}

      <Reveal>
        <section className="border-t border-line/70 bg-bg-elevated/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-2 md:items-start md:px-8 md:py-20">
            <div>
              <p className="text-sm font-medium tracking-wide text-sage uppercase">About</p>
              <h2 className="mt-2 font-display text-4xl font-semibold tracking-tight">
                {siteContent.name}
              </h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-muted">
                {siteContent.about.body ||
                  'About copy goes in site.json. Keep this homepage teaser short — the full story lives on the About page.'}
              </p>
              <Link
                to="/about"
                className="mt-6 inline-block text-sm font-semibold text-sage-deep hover:underline"
              >
                Read more
              </Link>
            </div>
            {hasValue(siteContent.about.photo) ? (
              <img
                src={siteContent.about.photo}
                alt={siteContent.name}
                className="w-full object-cover"
              />
            ) : (
              <Placeholder
                label="Portrait / field photo"
                hint="Set about.photo in site.json"
                aspect="video"
              />
            )}
          </div>
        </section>
      </Reveal>
    </div>
  )
}
