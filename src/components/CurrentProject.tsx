import { Link } from 'react-router-dom'
import type { Project } from '../lib/types'
import { hasValue } from '../lib/content'
import { Placeholder } from './Placeholder'

type CurrentProjectProps = {
  project: Project
}

export function CurrentProject({ project }: CurrentProjectProps) {
  return (
    <section className="border-b border-line/70 bg-bg-elevated/50">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 md:py-20">
        <p className="text-sm font-medium tracking-wide text-sky uppercase">Currently building</p>
        <div className="mt-6 grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-center">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <span className="border border-sage/40 bg-sage/10 px-2 py-0.5 text-sage-deep">
                In progress
              </span>
              {project.year ? <span>{project.year}</span> : null}
              {project.tags?.length ? (
                <span className="text-stone">{project.tags.join(' · ')}</span>
              ) : null}
            </div>
            <h2 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
              {project.title}
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-muted">
              {project.summary}
            </p>
            <Link
              to={`/projects/${project.slug}`}
              className="mt-8 inline-block bg-sage-deep px-5 py-3 text-sm font-semibold text-white transition hover:bg-ink"
            >
              View project
            </Link>
          </div>
          {hasValue(project.coverImage) ? (
            <img
              src={project.coverImage}
              alt={project.title}
              className="w-full object-cover"
            />
          ) : (
            <Placeholder
              label="Current project photo"
              hint="Set coverImage on this project when you have one"
              aspect="video"
            />
          )}
        </div>
      </div>
    </section>
  )
}
