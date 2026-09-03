import { Link } from 'react-router-dom'
import type { Project } from '../lib/types'
import { hasValue } from '../lib/content'
import { Placeholder } from './Placeholder'
import { Reveal } from './Reveal'

type ProjectCardProps = {
  project: Project
  delayMs?: number
}

export function ProjectCard({ project, delayMs = 0 }: ProjectCardProps) {
  return (
    <Reveal delayMs={delayMs}>
      <Link
        to={`/projects/${project.slug}`}
        className="group block border-b border-line py-8 transition-colors hover:bg-bg-elevated/50"
      >
        <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              {project.status === 'in-progress' ? (
                <span className="border border-sage/40 bg-sage/10 px-2 py-0.5 text-sage-deep">
                  In progress
                </span>
              ) : null}
              {project.year ? <span>{project.year}</span> : null}
              {project.tags?.length ? (
                <span className="text-stone">{project.tags.join(' · ')}</span>
              ) : null}
            </div>
            <h3 className="font-display text-3xl font-semibold tracking-tight text-ink transition-colors group-hover:text-sage-deep md:text-4xl">
              {project.title}
            </h3>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-muted md:text-lg">
              {project.summary || 'Add a one-line summary in projects.json.'}
            </p>
          </div>
          {hasValue(project.coverImage) ? (
            <img
              src={project.coverImage}
              alt={project.title}
              className="h-full max-h-64 w-full object-cover"
            />
          ) : (
            <Placeholder
              label="Cover image"
              hint={`Add media at public/media/projects/${project.slug}/`}
              aspect="video"
            />
          )}
        </div>
      </Link>
    </Reveal>
  )
}
