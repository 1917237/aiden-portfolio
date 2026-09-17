import type { Project } from '../lib/types'
import {
  getProjectCover,
  hasValue,
  projectUsesModelCover,
} from '../lib/portfolioStore'
import { ModelViewerSlot } from './ModelViewerSlot'
import { Placeholder } from './Placeholder'

type ProjectThumbProps = {
  project: Project
  className?: string
  alt?: string
}

/** Cover image, or 3D model when no cover is set. */
export function ProjectThumb({ project, className = '', alt }: ProjectThumbProps) {
  const cover = getProjectCover(project)
  const useModel = projectUsesModelCover(project)

  if (hasValue(cover)) {
    return (
      <img
        src={cover}
        alt={alt ?? project.title}
        className={`h-full w-full object-cover ${className}`.trim()}
      />
    )
  }

  if (useModel) {
    return (
      <ModelViewerSlot
        src={project.model}
        alt={alt ?? project.title}
        interactive={false}
        className={`h-full min-h-0 border-0 ${className}`.trim()}
      />
    )
  }

  return (
    <Placeholder
      label="·"
      hint={`media/projects/${project.slug}/`}
      aspect="video"
      className={`h-full border-0 ${className}`.trim()}
    />
  )
}
