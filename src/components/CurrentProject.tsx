import { Link } from 'react-router-dom'
import type { Project } from '../lib/types'
import { ProjectThumb } from './ProjectThumb'

type CurrentProjectProps = {
  project: Project
}

export function CurrentProject({ project }: CurrentProjectProps) {
  return (
    <section className="border-b border-line/80 bg-bg-elevated/60">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <p className="portfolio-eyebrow">Currently building</p>
        <div className="mt-8 grid gap-10 md:grid-cols-[1.05fr_0.95fr] md:items-center">
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <span className="border border-sage/35 bg-sage/10 px-2.5 py-0.5 font-medium text-sage-deep">
                In progress
              </span>
              {project.year ? <span>{project.year}</span> : null}
              {project.tags?.length ? (
                <span className="text-stone">{project.tags.join(' · ')}</span>
              ) : null}
            </div>
            <h2 className="font-display text-4xl font-bold tracking-tight md:text-5xl">
              {project.title}
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
              {project.summary}
            </p>
            <Link to={`/projects/${project.slug}`} className="portfolio-cta mt-10">
              View project
            </Link>
          </div>
          <div className="media-zoom relative aspect-video overflow-hidden border border-line">
            <ProjectThumb project={project} className="absolute inset-0" />
          </div>
        </div>
      </div>
    </section>
  )
}
