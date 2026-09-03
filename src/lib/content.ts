import site from '../content/site.json'
import projectsData from '../content/projects.json'
import type { Project, SiteContent } from './types'

export const siteContent = site as SiteContent

export const projects = (projectsData.projects ?? []) as Project[]

export function getCurrentProject(): Project | undefined {
  const slug = siteContent.home.currentProjectSlug?.trim()
  if (!slug) return undefined
  return projects.find((project) => project.slug === slug)
}

export function getProjectBySlug(slug: string): Project | undefined {
  return projects.find((project) => project.slug === slug)
}

export function hasValue(value?: string | string[] | null): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value && value.trim().length > 0)
}
