import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { GallerySlideshow } from '../components/GallerySlideshow'
import { ModelViewerSlot } from '../components/ModelViewerSlot'
import { ProjectVideos } from '../components/ProjectVideos'
import { usePortfolio } from '../lib/PortfolioContext'
import { projectSections, visibleGallery } from '../lib/portfolioStore'

function Section({ title, body }: { title: string; body: string }) {
  return (
    <section className="border-t border-line py-8">
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-muted whitespace-pre-wrap md:text-lg">
        {body}
      </p>
    </section>
  )
}

export function ProjectDetail() {
  const { slug } = useParams()
  const { siteContent, getProjectBySlug, hasValue } = usePortfolio()
  const project = slug ? getProjectBySlug(slug) : undefined
  const isCurrent = Boolean(project && siteContent.home.currentProjectSlug === project.slug)
  const sections = project ? projectSections(project) : []
  const gallery = project ? visibleGallery(project) : []

  if (!project) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-16 md:px-8">
        <EmptyState title="Project not found">
          <p>
            No project with slug <code>{slug}</code>.
          </p>
          <p>
            <Link to="/projects" className="font-semibold text-sage-deep hover:underline">
              ← All projects
            </Link>
          </p>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-16 md:px-8 md:py-24">
      <Link
        to="/projects"
        className="text-sm font-semibold text-sage-deep transition-colors hover:text-ink"
      >
        ← All projects
      </Link>

      <div className="mt-8 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          {isCurrent || project.status === 'in-progress' ? (
            <span className="font-medium text-sage">In progress</span>
          ) : null}
          {project.year ? <span>{project.year}</span> : null}
          {project.tags?.length ? <span>{project.tags.join(' · ')}</span> : null}
        </div>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight md:text-6xl">
          {project.title}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-muted md:text-xl">
          {project.summary || 'Add a summary in Portfolio admin.'}
        </p>
      </div>

      {hasValue(project.model) ? (
        <div className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-bold tracking-tight">3D model</h2>
          <div className="border border-line">
            <ModelViewerSlot src={project.model} alt={project.title} />
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        {sections.length > 0 ? (
          sections.map((section) => (
            <Section key={section.id} title={section.title} body={section.body} />
          ))
        ) : (
          <p className="border-t border-line py-8 text-sm text-ink-muted italic">
            Add write-up sections in Portfolio admin.
          </p>
        )}
      </div>

      {gallery.length > 0 ? (
        <section className="border-t border-line py-8">
          <h2 className="font-display text-2xl font-bold tracking-tight">Gallery</h2>
          <GallerySlideshow images={gallery} altPrefix={project.title} />
        </section>
      ) : null}

      <ProjectVideos videos={project.videos} projectSlug={project.slug} />
    </div>
  )
}
