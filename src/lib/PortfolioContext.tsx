import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  fallbackProjects,
  fallbackSiteContent,
  fetchPortfolioFromDb,
  getProjectCover,
  hasValue,
  normalizeProject,
} from './portfolioStore'
import type { Project, SiteContent } from './types'

type PortfolioContextValue = {
  siteContent: SiteContent
  projects: Project[]
  loading: boolean
  source: 'database' | 'fallback'
  reload: () => Promise<void>
  getCurrentProject: () => Project | undefined
  getProjectBySlug: (slug: string) => Project | undefined
  getProjectCover: typeof getProjectCover
  hasValue: typeof hasValue
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null)

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [siteContent, setSiteContent] = useState<SiteContent>(fallbackSiteContent)
  const [projects, setProjects] = useState<Project[]>(fallbackProjects.map(normalizeProject))
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'database' | 'fallback'>('fallback')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { site, projects: dbProjects } = await fetchPortfolioFromDb()
      if (site) {
        setSiteContent(site)
        setSource('database')
      } else {
        setSiteContent(fallbackSiteContent)
      }
      if (dbProjects) {
        setProjects(dbProjects)
        setSource('database')
      } else if (!site) {
        setProjects(fallbackProjects.map(normalizeProject))
        setSource('fallback')
      }
    } catch {
      setSiteContent(fallbackSiteContent)
      setProjects(fallbackProjects.map(normalizeProject))
      setSource('fallback')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo<PortfolioContextValue>(
    () => ({
      siteContent,
      projects,
      loading,
      source,
      reload,
      getCurrentProject: () => {
        const slug = siteContent.home.currentProjectSlug?.trim()
        if (!slug) return undefined
        return projects.find((project) => project.slug === slug)
      },
      getProjectBySlug: (slug: string) => projects.find((project) => project.slug === slug),
      getProjectCover,
      hasValue,
    }),
    [siteContent, projects, loading, source, reload],
  )

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext)
  if (!ctx) {
    throw new Error('usePortfolio must be used within PortfolioProvider')
  }
  return ctx
}
