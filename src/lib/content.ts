/** @deprecated Prefer usePortfolio() for live content. Helpers remain for shared utils. */
export {
  fallbackSiteContent as siteContent,
  fallbackProjects as projects,
  getProjectCover,
  hasValue,
  normalizeProject,
  projectSections,
} from './portfolioStore'

import { fallbackProjects, fallbackSiteContent } from './portfolioStore'
import type { Project } from './types'

export function getCurrentProject(): Project | undefined {
  const slug = fallbackSiteContent.home.currentProjectSlug?.trim()
  if (!slug) return undefined
  return fallbackProjects.find((project) => project.slug === slug)
}

export function getProjectBySlug(slug: string): Project | undefined {
  return fallbackProjects.find((project) => project.slug === slug)
}
