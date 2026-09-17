import siteFallback from '../content/site.json'
import projectsFallback from '../content/projects.json'
import { isSupabaseConfigured, supabase } from './supabase'
import type { Project, ProjectSection, SiteContent } from './types'

export const fallbackSiteContent = siteFallback as SiteContent
export const fallbackProjects = (projectsFallback.projects ?? []) as Project[]

const LEGACY_SECTION_KEYS = [
  ['why', 'Why'],
  ['what', 'What it does'],
  ['how', 'How it works'],
  ['challenges', 'Challenges & decisions'],
  ['outcome', 'Outcome'],
] as const

export function hasValue(value?: string | string[] | null): boolean {
  if (Array.isArray(value)) return value.length > 0
  return Boolean(value && value.trim().length > 0)
}

export function getProjectCover(project: Project): string | undefined {
  if (hasValue(project.coverImage)) return project.coverImage
  return undefined
}

/** Gallery images shown on the project page (optionally hides the cover). */
export function visibleGallery(project: Project): string[] {
  const gallery = (project.gallery ?? []).filter((src) => hasValue(src))
  if (project.hideCoverFromGallery && hasValue(project.coverImage)) {
    return gallery.filter((src) => src !== project.coverImage)
  }
  return gallery
}

export function projectUsesModelCover(project: Project): boolean {
  return !hasValue(project.coverImage) && hasValue(project.model)
}

/** Normalize project so detail pages always get a sections array. */
export function normalizeProject(project: Project): Project {
  const withoutRole = (sections: ProjectSection[]) =>
    sections.filter((section) => {
      const title = section.title.trim().toLowerCase()
      return section.id !== 'role' && title !== 'my role'
    })

  if (project.sections && project.sections.length > 0) {
    return { ...project, sections: withoutRole(project.sections) }
  }
  const sections: ProjectSection[] = []
  for (const [key, title] of LEGACY_SECTION_KEYS) {
    const body = project[key]
    if (hasValue(body)) {
      sections.push({ id: key, title, body: body as string })
    }
  }
  return { ...project, sections }
}

export function projectSections(project: Project): ProjectSection[] {
  return normalizeProject(project).sections ?? []
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

/** Fill empty About (and other) fields from local JSON when the DB row is sparse. */
export function mergeSiteWithFallback(site: SiteContent): SiteContent {
  const fb = fallbackSiteContent
  const about = site.about ?? fb.about
  const skills = about.skills ?? fb.about.skills

  return {
    ...fb,
    ...site,
    email: hasValue(site.email) ? site.email : fb.email,
    phone: hasValue(site.phone) ? site.phone : fb.phone,
    tagline: hasValue(site.tagline) ? site.tagline : fb.tagline,
    name: hasValue(site.name) ? site.name : fb.name,
    links: {
      ...fb.links,
      ...site.links,
      github: hasValue(site.links?.github) ? site.links.github : fb.links.github,
      linkedin: hasValue(site.links?.linkedin) ? site.links.linkedin : fb.links.linkedin,
      resume: hasValue(site.links?.resume) ? site.links.resume : fb.links.resume,
      other: site.links?.other?.length ? site.links.other : fb.links.other,
    },
    about: {
      ...fb.about,
      ...about,
      headline: hasValue(about.headline) ? about.headline : fb.about.headline,
      body: hasValue(about.body) ? about.body : fb.about.body,
      photo: hasValue(about.photo) ? about.photo : fb.about.photo,
      skills: {
        languages: skills.languages?.length ? skills.languages : fb.about.skills.languages,
        robotics: skills.robotics?.length ? skills.robotics : fb.about.skills.robotics,
        hardware: skills.hardware?.length ? skills.hardware : fb.about.skills.hardware,
      },
      interests: about.interests?.length ? about.interests : fb.about.interests,
    },
    home: {
      ...fb.home,
      ...site.home,
      supporting: hasValue(site.home?.supporting) ? site.home.supporting : fb.home.supporting,
      heroImage: hasValue(site.home?.heroImage) ? site.home.heroImage : fb.home.heroImage,
      currentProjectSlug: hasValue(site.home?.currentProjectSlug)
        ? site.home.currentProjectSlug
        : fb.home.currentProjectSlug,
    },
  }
}

export async function fetchPortfolioFromDb(): Promise<{
  site: SiteContent | null
  projects: Project[] | null
}> {
  if (!isSupabaseConfigured) {
    return { site: null, projects: null }
  }

  const [siteRes, projectsRes] = await Promise.all([
    supabase.from('portfolio_site').select('content').eq('id', 1).maybeSingle(),
    supabase.from('portfolio_projects').select('slug, sort_order, data').order('sort_order'),
  ])

  // Tables missing / not migrated yet → fall back silently
  if (siteRes.error && /relation|does not exist|schema cache/i.test(siteRes.error.message)) {
    return { site: null, projects: null }
  }
  if (projectsRes.error && /relation|does not exist|schema cache/i.test(projectsRes.error.message)) {
    return { site: null, projects: null }
  }

  const rawSite =
    siteRes.data?.content && typeof siteRes.data.content === 'object'
      ? (siteRes.data.content as SiteContent)
      : null

  const site = rawSite ? mergeSiteWithFallback(rawSite) : null

  const projects =
    projectsRes.data?.map((row) =>
      normalizeProject({
        ...(row.data as Project),
        slug: row.slug,
      }),
    ) ?? null

  return { site, projects: projects && projects.length > 0 ? projects : null }
}

function asError(err: unknown): Error {
  if (err instanceof Error) return err
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: unknown }).message ?? 'Unknown error')
    const code =
      'code' in err && (err as { code?: unknown }).code
        ? ` [${String((err as { code?: unknown }).code)}]`
        : ''
    return new Error(`${msg}${code}`)
  }
  return new Error(typeof err === 'string' ? err : 'Unknown error')
}

export async function saveSiteContent(content: SiteContent): Promise<void> {
  const { error } = await supabase.from('portfolio_site').upsert({
    id: 1,
    content,
    updated_at: new Date().toISOString(),
  })
  if (error) throw asError(error)
}

export async function saveAllProjects(projects: Project[]): Promise<void> {
  const { data: existing, error: listError } = await supabase
    .from('portfolio_projects')
    .select('id')
  if (listError) throw asError(listError)

  if (existing && existing.length > 0) {
    const { error: delError } = await supabase
      .from('portfolio_projects')
      .delete()
      .in(
        'id',
        existing.map((row) => row.id),
      )
    if (delError) throw asError(delError)
  }

  if (projects.length === 0) return

  const rows = projects.map((project, index) => ({
    slug: project.slug,
    sort_order: index,
    data: normalizeProject(project),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('portfolio_projects').insert(rows)
  if (error) throw asError(error)
}

export async function seedPortfolioFromFallback(): Promise<void> {
  await saveSiteContent(fallbackSiteContent)
  await saveAllProjects(fallbackProjects.map(normalizeProject))
}

export async function uploadPortfolioFile(
  file: File,
  path: string,
): Promise<string> {
  const { error } = await supabase.storage.from('portfolio').upload(path, file, {
    upsert: true,
    cacheControl: '3600',
  })
  if (error) throw asError(error)
  const { data } = supabase.storage.from('portfolio').getPublicUrl(path)
  return data.publicUrl
}

export function youtubeIdFromInput(input: string): string | null {
  const trimmed = input.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace('/', '')
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    const v = url.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
  } catch {
    return null
  }
  return null
}
