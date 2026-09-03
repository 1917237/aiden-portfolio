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
  model?: string
  gallery?: string[]
  videos?: ProjectVideo[]
  why?: string
  what?: string
  role?: string
  how?: string
  challenges?: string
  outcome?: string
  bodyMarkdown?: string
}
