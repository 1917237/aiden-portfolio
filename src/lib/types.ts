export type SiteLink = {
  label: string
  url: string
}

export type ProjectVideo =
  | {
      type: 'youtube'
      id: string
      title?: string
    }
  | {
      type: 'file'
      src: string
      title?: string
    }

/** Editable write-up blocks on a project page (add/remove freely). */
export type ProjectSection = {
  id: string
  title: string
  body: string
}

export type SiteContent = {
  name: string
  tagline: string
  email: string
  phone: string
  links: {
    github: string
    linkedin: string
    resume: string
    other: SiteLink[]
  }
  about: {
    headline: string
    body: string
    photo: string
    skills: {
      languages: string[]
      robotics: string[]
      hardware: string[]
    }
    interests: string[]
  }
  home: {
    supporting: string
    heroImage: string
    currentProjectSlug: string
  }
}

export type Project = {
  slug: string
  title: string
  summary: string
  status?: 'in-progress' | 'completed'
  year?: string
  tags?: string[]
  coverImage?: string
  /** When true, coverImage is omitted from the public gallery even if it is also in gallery[]. */
  hideCoverFromGallery?: boolean
  model?: string
  gallery?: string[]
  videos?: ProjectVideo[]
  /** Preferred flexible sections. Legacy why/what/… still supported as fallback. */
  sections?: ProjectSection[]
  why?: string
  what?: string
  role?: string
  how?: string
  challenges?: string
  outcome?: string
  bodyMarkdown?: string
}
