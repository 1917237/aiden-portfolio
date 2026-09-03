import { EmptyState } from '../components/EmptyState'
import { ProjectCard } from '../components/ProjectCard'
import { Reveal } from '../components/Reveal'
import { projects } from '../lib/content'

export function Projects() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 md:py-20">
      <Reveal immediate>
        <p className="text-sm font-medium tracking-wide text-sage uppercase">Work</p>
        <h1 className="mt-2 font-display text-5xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-muted">
          Open project for full write up
        </p>
      </Reveal>

      <div className="mt-10 border-t border-line">
        {projects.length === 0 ? (
          <Reveal>
            <EmptyState title="Project list is empty">
              <p>
                Add objects to the <code>projects</code> array in{' '}
                <code>src/content/projects.json</code>. Use{' '}
                <code>src/content/projects/_template.json</code> as a guide.
              </p>
            </EmptyState>
          </Reveal>
        ) : (
          projects.map((project, index) => (
            <ProjectCard key={project.slug} project={project} delayMs={index * 70} />
          ))
        )}
      </div>
    </div>
  )
}
