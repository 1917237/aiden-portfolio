import { EmptyState } from '../components/EmptyState'
import { ProjectCard } from '../components/ProjectCard'
import { Reveal } from '../components/Reveal'
import { usePortfolio } from '../lib/PortfolioContext'

export function Projects() {
  const { projects } = usePortfolio()

  return (
    <div className="mx-auto max-w-5xl px-5 py-14 md:px-8 md:py-20">
      <Reveal immediate>
        <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
          Projects
        </h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted md:text-base">
          Builds with notes on decisions and outcomes.
        </p>
      </Reveal>

      <div className="mt-10 border-t border-line">
        {projects.length === 0 ? (
          <Reveal>
            <EmptyState title="No projects yet">
              <p>Add projects in the Portfolio admin tab after signing in to tutoring.</p>
            </EmptyState>
          </Reveal>
        ) : (
          projects.map((project, index) => (
            <ProjectCard
              key={project.slug}
              project={project}
              index={index}
              delayMs={index * 50}
            />
          ))
        )}
      </div>
    </div>
  )
}
