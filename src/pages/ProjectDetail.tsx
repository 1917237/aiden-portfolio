import ReactMarkdown from 'react-markdown'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ModelViewerSlot } from '../components/ModelViewerSlot'
import { Placeholder } from '../components/Placeholder'
import { ProjectVideos } from '../components/ProjectVideos'
import { getProjectBySlug, hasValue, siteContent } from '../lib/content'

function Section({
  title,
  body,
}: {
  title: string
  body?: string
}) {
  return (
    <section className="border-t border-line py-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
      {hasValue(body) ? (
        <p className="mt-3 max-w-3xl text-lg leading-relaxed text-ink-muted whitespace-pre-wrap">
          {body}
        </p>
      ) : (
        <p className="mt-3 text-ink-muted italic">Add this section in projects.json.</p>
      )}
    </section>
  )
}

export function ProjectDetail() {
  const { slug } = useParams()
  const project = slug ? getProjectBySlug(slug) : undefined
  const isCurrent = Boolean(
    project && siteContent.home.currentProjectSlug === project.slug,
  )

  if (!project) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8">
        <EmptyState title="Project not found">
          <p>
            No project with slug <code>{slug}</code>. Check <code>projects.json</code>.
          </p>
          <p>
            <Link to="/projects" className="font-semibold text-sage-deep hover:underline">
              Back to projects
            </Link>
          </p>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
      <Link to="/projects" className="text-sm font-semibold text-sage-deep hover:underline">
        ← All projects
      </Link>

      <div className="mt-6 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          {isCurrent || project.status === 'in-progress' ? (
            <span className="border border-sage/40 bg-sage/10 px-2 py-0.5 text-sage-deep">
              In progress
            </span>
          ) : null}
          {project.year ? <span>{project.year}</span> : null}
          {project.tags?.length ? <span>{project.tags.join(' · ')}</span> : null}
        </div>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight md:text-6xl">
          {project.title}
        </h1>
        <p className="mt-4 text-xl leading-relaxed text-ink-muted">
          {project.summary || 'Add a summary in projects.json.'}
        </p>
      </div>

      <div className="mt-10">
        {hasValue(project.coverImage) ? (
          <img
            src={project.coverImage}
            alt={project.title}
            className="max-h-[32rem] w-full object-cover"
          />
        ) : (
          <Placeholder
            label="Hero / cover image"
            hint={`public/media/projects/${project.slug}/cover.jpg`}
            aspect="wide"
          />
        )}
      </div>

      <div className="mt-10">
        <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">3D model</h2>
        <ModelViewerSlot
          src={hasValue(project.model) ? project.model : undefined}
          alt={project.title}
        />
      </div>

      <div className="mt-4">
        <Section title="Why" body={project.why} />
        <Section title="What it does" body={project.what} />
        <Section title="My role" body={project.role} />
        <Section title="How it works" body={project.how} />
        <Section title="Challenges & decisions" body={project.challenges} />
        <Section title="Outcome" body={project.outcome} />
      </div>

      {hasValue(project.bodyMarkdown) ? (
        <section className="prose-portfolio border-t border-line py-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Notes</h2>
          <div className="mt-4 max-w-3xl space-y-3 text-lg leading-relaxed text-ink-muted [&_a]:text-sage-deep [&_a]:underline [&_strong]:text-ink">
            <ReactMarkdown>{project.bodyMarkdown}</ReactMarkdown>
          </div>
        </section>
      ) : null}

      <section className="border-t border-line py-8">
        <h2 className="font-display text-2xl font-semibold tracking-tight">Project gallery</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {project.gallery && project.gallery.length > 0 ? (
            project.gallery.map((src) => (
              <img key={src} src={src} alt="" className="w-full object-cover" />
            ))
          ) : (
            <>
              <Placeholder label="Photo 1" hint="Add paths to gallery[]" aspect="video" />
              <Placeholder label="Photo 2" hint="CAD, prototype, demo stills" aspect="video" />
            </>
          )}
        </div>
      </section>

      <ProjectVideos videos={project.videos} projectSlug={project.slug} />
    </div>
  )
}
