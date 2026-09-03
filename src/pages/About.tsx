import { Placeholder } from '../components/Placeholder'
import { Reveal } from '../components/Reveal'
import { hasValue, siteContent } from '../lib/content'

function SkillGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold tracking-wide text-sage uppercase">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-1 text-ink-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink-muted italic">Add items in site.json → about.skills</p>
      )}
    </div>
  )
}

export function About() {
  const { about } = siteContent

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
      <Reveal immediate>
        <p className="text-sm font-medium tracking-wide text-sage uppercase">About</p>
        <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">
          {about.headline || siteContent.name}
        </h1>
      </Reveal>

      <Reveal delayMs={80}>
        <div className="mt-10 grid gap-10 md:grid-cols-[0.9fr_1.1fr] md:items-start">
          {hasValue(about.photo) ? (
            <img src={about.photo} alt={siteContent.name} className="w-full object-cover" />
          ) : (
            <Placeholder
              label="About photo"
              hint="Set about.photo in site.json"
              aspect="tall"
            />
          )}

          <div>
            {hasValue(about.body) ? (
              <p className="text-xl leading-relaxed text-ink-muted whitespace-pre-wrap">{about.body}</p>
            ) : (
              <p className="text-lg leading-relaxed text-ink-muted italic">
                Write your about bio in <code>src/content/site.json</code> under{' '}
                <code>about.body</code>. Mention UCSC Robotics, what you like building, and a bit of
                personality (outdoors, teaching, scouting — whatever fits).
              </p>
            )}

            <div className="mt-10 grid gap-8 sm:grid-cols-3">
              <SkillGroup title="Languages" items={about.skills.languages} />
              <SkillGroup title="Robotics & CV" items={about.skills.robotics} />
              <SkillGroup title="Hardware & CAD" items={about.skills.hardware} />
            </div>

            <div className="mt-10">
              <h3 className="text-sm font-semibold tracking-wide text-sage uppercase">Interests</h3>
              {about.interests.length > 0 ? (
                <p className="mt-3 text-ink-muted">{about.interests.join(' · ')}</p>
              ) : (
                <p className="mt-3 text-sm text-ink-muted italic">
                  Add interests in site.json → about.interests
                </p>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  )
}
