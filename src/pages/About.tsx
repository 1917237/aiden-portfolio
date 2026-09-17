import { Placeholder } from '../components/Placeholder'
import { Reveal } from '../components/Reveal'
import { usePortfolio } from '../lib/PortfolioContext'

function SkillGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="label-mono">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-ink-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-muted italic">Add skills in the Portfolio admin.</p>
      )}
    </div>
  )
}

export function About() {
  const { siteContent, hasValue } = usePortfolio()
  const { about } = siteContent

  return (
    <div className="mx-auto max-w-5xl px-5 py-14 md:px-8 md:py-20">
      <Reveal immediate>
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          {about.headline === 'About' ? siteContent.name : about.headline || siteContent.name}
        </h1>
      </Reveal>

      <Reveal delayMs={60}>
        <div className="mt-10 grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="media-zoom border border-line">
            {hasValue(about.photo) ? (
              <img src={about.photo} alt={siteContent.name} className="w-full object-cover" />
            ) : (
              <Placeholder label="Portrait" hint="Upload in Portfolio admin" aspect="tall" />
            )}
          </div>

          <div>
            {hasValue(about.body) ? (
              <p className="text-base leading-relaxed text-ink-muted whitespace-pre-wrap md:text-lg">
                {about.body}
              </p>
            ) : (
              <p className="text-base leading-relaxed text-ink-muted italic">
                Add your bio in the Portfolio admin tab.
              </p>
            )}

            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              <SkillGroup title="Languages" items={about.skills.languages} />
              <SkillGroup title="Systems" items={about.skills.robotics} />
              <SkillGroup title="Hardware" items={about.skills.hardware} />
            </div>

            <div className="mt-10 border-t border-line pt-8">
              <h3 className="label-mono">Interests</h3>
              {about.interests.length > 0 ? (
                <p className="mt-3 text-ink-muted">{about.interests.join(' · ')}</p>
              ) : (
                <p className="mt-3 text-sm text-ink-muted italic">Add in Portfolio admin</p>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  )
}
