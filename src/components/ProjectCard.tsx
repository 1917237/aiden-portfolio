import { Link } from 'react-router-dom'
import type { Project } from '../lib/types'
import { ProjectThumb } from './ProjectThumb'
import { Reveal } from './Reveal'

type ProjectCardProps = {
  project: Project
  delayMs?: number
  index?: number
}

export function ProjectCard({ project, delayMs = 0, index = 0 }: ProjectCardProps) {
  const id = String(index + 1).padStart(2, '0')

  return (
    <Reveal delayMs={delayMs}>
      <Link
        to={`/projects/${project.slug}`}
        className="work-row group grid gap-5 border-b border-line py-7 md:grid-cols-[7.5rem_1fr] md:items-center md:gap-8 md:py-8"
      >
        <div className="media-zoom relative aspect-[4/3] overflow-hidden border border-line">
          <ProjectThumb project={project} className="absolute inset-0" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span className="font-mono text-stone">{id}</span>
            {project.status === 'in-progress' ? (
              <span className="text-sage">In progress</span>
            ) : null}
            {project.year ? <span>{project.year}</span> : null}
            {project.tags?.length ? (
              <span className="text-stone">{project.tags.slice(0, 2).join(' · ')}</span>
            ) : null}
          </div>
          <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight transition-colors group-hover:text-sage-deep md:text-xl">
            {project.title}
          </h3>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-muted">
            {project.summary || 'Add a one-line summary in projects.json.'}
          </p>
        </div>
      </Link>
    </Reveal>
  )
}
