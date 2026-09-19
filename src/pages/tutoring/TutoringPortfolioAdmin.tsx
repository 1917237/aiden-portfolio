import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AdminTimezoneProvider } from '../../tutoring/AdminTimezoneContext'
import { useTutoringSession } from '../../tutoring/useTutoringSession'
import {
  fallbackProjects,
  fallbackSiteContent,
  normalizeProject,
  saveAllProjects,
  saveSiteContent,
  seedPortfolioFromFallback,
  slugify,
  uploadPortfolioFile,
  youtubeIdFromInput,
} from '../../lib/portfolioStore'
import type { Project, ProjectSection, ProjectVideo, SiteContent } from '../../lib/types'
import { AdminNav } from './AdminNav'

type Tab = 'site' | 'projects'

function newSection(): ProjectSection {
  return { id: crypto.randomUUID(), title: 'New section', body: '' }
}

function emptyProject(): Project {
  return normalizeProject({
    slug: `project-${Date.now()}`,
    title: 'New project',
    summary: '',
    status: 'in-progress',
    year: '',
    tags: [],
    coverImage: '',
    hideCoverFromGallery: false,
    gallery: [],
    videos: [],
    sections: [newSection()],
  })
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-sage'
const areaClass = `${inputClass} min-h-[96px] resize-y`

export function TutoringPortfolioAdmin() {
  const { session, profile, loading } = useTutoringSession()
  const [tab, setTab] = useState<Tab>('site')
  const [site, setSite] = useState<SiteContent>(
    structuredClone(fallbackSiteContent),
  )
  const [projects, setProjects] = useState<Project[]>(
    fallbackProjects.map((p) => structuredClone(normalizeProject(p))),
  )
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    fallbackProjects[0]?.slug ?? null,
  )
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [youtubeInput, setYoutubeInput] = useState('')

  const selected = useMemo(
    () => projects.find((p) => p.slug === selectedSlug) ?? null,
    [projects, selectedSlug],
  )

  useEffect(() => {
    if (!session || profile?.role !== 'admin') return
    let cancelled = false
    void (async () => {
      try {
        const { fetchPortfolioFromDb } = await import('../../lib/portfolioStore')
        const { site: dbSite, projects: dbProjects } = await fetchPortfolioFromDb()
        if (cancelled) return
        if (dbSite) setSite(structuredClone(dbSite))
        if (dbProjects) {
          setProjects(dbProjects.map((p) => structuredClone(p)))
          setSelectedSlug(dbProjects[0]?.slug ?? null)
        }
      } catch {
        // keep fallbacks
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, profile?.role])

  if (!loading && !session) {
    return <Navigate to="/tutoring/login" replace />
  }

  if (!loading && profile && profile.role !== 'admin') {
    return <Navigate to="/tutoring/dashboard" replace />
  }

  if (loading || !profile) {
    return <div className="mx-auto max-w-6xl px-5 py-20 text-ink-muted">Loading…</div>
  }

  function updateSelected(patch: Partial<Project>) {
    if (!selectedSlug) return
    setProjects((prev) =>
      prev.map((p) => (p.slug === selectedSlug ? { ...p, ...patch } : p)),
    )
  }

  async function handleSaveSite() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await saveSiteContent(site)
      setMessage('Site settings saved. Public portfolio will pick this up on refresh.')
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Save failed.'
      const hint = /relation|does not exist|schema cache|Could not find the table/i.test(msg)
        ? ' Run supabase/migrations/50-portfolio-cms.sql in the Supabase SQL Editor first.'
        : /permission|policy|RLS|not authorized|42501/i.test(msg)
          ? ' Sign in as an admin account.'
          : ''
      setError(`${msg}${hint}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveProjects() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const cleaned = projects.map((p) => normalizeProject(p))
      await saveAllProjects(cleaned)
      setProjects(cleaned)
      setMessage('Projects saved. Public portfolio will pick this up on refresh.')
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Save failed.'
      const hint = /relation|does not exist|schema cache|Could not find the table/i.test(msg)
        ? ' Run supabase/migrations/50-portfolio-cms.sql in the Supabase SQL Editor first.'
        : /permission|policy|RLS|not authorized|42501/i.test(msg)
          ? ' Sign in as an admin account.'
          : ''
      setError(`${msg}${hint}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSeed() {
    if (!confirm('Replace database portfolio with the built-in JSON starter content?')) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await seedPortfolioFromFallback()
      setSite(structuredClone(fallbackSiteContent))
      const seeded = fallbackProjects.map((p) => structuredClone(normalizeProject(p)))
      setProjects(seeded)
      setSelectedSlug(seeded[0]?.slug ?? null)
      setMessage('Seeded from built-in JSON.')
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Seed failed.'
      const hint = /relation|does not exist|schema cache|Could not find the table/i.test(msg)
        ? ' Run supabase/migrations/50-portfolio-cms.sql in the Supabase SQL Editor, then try again.'
        : /permission|policy|RLS|not authorized|42501/i.test(msg)
          ? ' Sign in as an admin account (profiles.role = admin).'
          : ''
      setError(`${msg}${hint}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(
    file: File | null,
    kind: 'cover' | 'gallery' | 'about' | 'model',
  ) {
    if (!file) return
    setSaving(true)
    setError('')
    try {
      const stamp = Date.now()
      const safeName = file.name.replace(/[^\w.-]+/g, '-')
      if (kind === 'about') {
        const url = await uploadPortfolioFile(file, `about/${stamp}-${safeName}`)
        setSite((prev) => ({
          ...prev,
          about: { ...prev.about, photo: url },
        }))
        setMessage('About photo uploaded. click Save site to publish.')
      } else if (!selected) {
        setError('Select a project first.')
      } else {
        const url = await uploadPortfolioFile(
          file,
          `projects/${selected.slug}/${kind}-${stamp}-${safeName}`,
        )
        if (kind === 'cover') {
          updateSelected({ coverImage: url })
        } else if (kind === 'model') {
          updateSelected({ model: url })
        } else {
          updateSelected({ gallery: [...(selected.gallery ?? []), url] })
        }
        setMessage(
          kind === 'model'
            ? '3D model uploaded. click Save projects to publish.'
            : 'Image uploaded. click Save projects to publish.',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setSaving(false)
    }
  }

  function addProject() {
    const project = emptyProject()
    setProjects((prev) => [...prev, project])
    setSelectedSlug(project.slug)
    setTab('projects')
  }

  function removeProject(slug: string) {
    if (!confirm(`Delete project “${slug}”?`)) return
    setProjects((prev) => {
      const next = prev.filter((p) => p.slug !== slug)
      setSelectedSlug(next[0]?.slug ?? null)
      return next
    })
  }

  function moveProject(slug: string, dir: -1 | 1) {
    setProjects((prev) => {
      const index = prev.findIndex((p) => p.slug === slug)
      const nextIndex = index + dir
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(index, 1)
      copy.splice(nextIndex, 0, item)
      return copy
    })
  }

  function addYoutube() {
    if (!selected) return
    const id = youtubeIdFromInput(youtubeInput)
    if (!id) {
      setError('Paste a YouTube URL or 11-character video id.')
      return
    }
    const video: ProjectVideo = { type: 'youtube', id }
    updateSelected({ videos: [...(selected.videos ?? []), video] })
    setYoutubeInput('')
    setError('')
  }

  return (
    <AdminTimezoneProvider>
      <div className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-muted">Tutoring admin</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Portfolio</h1>
            <p className="mt-2 max-w-xl text-sm text-ink-muted">
              Edit site copy, projects, images, YouTube videos, and write-up sections. Saves to
              Supabase (run <code>50-portfolio-cms.sql</code> once if you have not).
            </p>
          </div>
          <AdminNav current="portfolio" />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            className={`border border-line px-3 py-1.5 text-sm font-semibold ${
              tab === 'site' ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'
            }`}
            onClick={() => setTab('site')}
          >
            Site
          </button>
          <button
            type="button"
            className={`border border-line px-3 py-1.5 text-sm font-semibold ${
              tab === 'projects' ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'
            }`}
            onClick={() => setTab('projects')}
          >
            Projects
          </button>
          <button
            type="button"
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated disabled:opacity-60"
            onClick={() => void handleSeed()}
            disabled={saving}
          >
            Seed from JSON
          </button>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="border border-line px-3 py-1.5 text-sm font-semibold hover:bg-bg-elevated"
          >
            Open live site →
          </a>
        </div>

        {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mt-4 text-sm text-sage-deep">{message}</p> : null}

        {tab === 'site' ? (
          <div className="mt-8 space-y-6 border border-line bg-white/70 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name">
                <input
                  className={inputClass}
                  value={site.name}
                  onChange={(e) => setSite({ ...site, name: e.target.value })}
                />
              </Field>
              <Field label="Tagline">
                <input
                  className={inputClass}
                  value={site.tagline}
                  onChange={(e) => setSite({ ...site, tagline: e.target.value })}
                />
              </Field>
              <Field label="Home supporting line">
                <textarea
                  className={areaClass}
                  value={site.home.supporting}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      home: { ...site.home, supporting: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Current project slug">
                <select
                  className={inputClass}
                  value={site.home.currentProjectSlug}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      home: { ...site.home, currentProjectSlug: e.target.value },
                    })
                  }
                >
                  <option value=""> none </option>
                  {projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.title} ({p.slug})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <input
                  className={inputClass}
                  value={site.email}
                  onChange={(e) => setSite({ ...site, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputClass}
                  value={site.phone}
                  onChange={(e) => setSite({ ...site, phone: e.target.value })}
                />
              </Field>
              <Field label="GitHub URL">
                <input
                  className={inputClass}
                  value={site.links.github}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      links: { ...site.links, github: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="LinkedIn URL">
                <input
                  className={inputClass}
                  value={site.links.linkedin}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      links: { ...site.links, linkedin: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Resume path / URL">
                <input
                  className={inputClass}
                  value={site.links.resume}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      links: { ...site.links, resume: e.target.value },
                    })
                  }
                />
              </Field>
            </div>

            <Field label="About body">
              <textarea
                className={areaClass}
                value={site.about.body}
                onChange={(e) =>
                  setSite({
                    ...site,
                    about: { ...site.about, body: e.target.value },
                  })
                }
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Skills. languages (comma-separated)">
                <input
                  className={inputClass}
                  value={site.about.skills.languages.join(', ')}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      about: {
                        ...site.about,
                        skills: {
                          ...site.about.skills,
                          languages: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
              </Field>
              <Field label="Skills. systems">
                <input
                  className={inputClass}
                  value={site.about.skills.robotics.join(', ')}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      about: {
                        ...site.about,
                        skills: {
                          ...site.about.skills,
                          robotics: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
              </Field>
              <Field label="Skills. hardware">
                <input
                  className={inputClass}
                  value={site.about.skills.hardware.join(', ')}
                  onChange={(e) =>
                    setSite({
                      ...site,
                      about: {
                        ...site.about,
                        skills: {
                          ...site.about.skills,
                          hardware: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      },
                    })
                  }
                />
              </Field>
            </div>

            <Field label="Interests (comma-separated)">
              <input
                className={inputClass}
                value={site.about.interests.join(', ')}
                onChange={(e) =>
                  setSite({
                    ...site,
                    about: {
                      ...site.about,
                      interests: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </Field>

            <div className="flex flex-wrap items-center gap-4">
              <Field label="About photo">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUpload(e.target.files?.[0] ?? null, 'about')}
                />
              </Field>
              {site.about.photo ? (
                <img
                  src={site.about.photo}
                  alt=""
                  className="h-20 w-16 border border-line object-cover"
                />
              ) : null}
            </div>

            <button
              type="button"
              className="border border-line bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={saving}
              onClick={() => void handleSaveSite()}
            >
              {saving ? 'Saving…' : 'Save site'}
            </button>
          </div>
        ) : null}

        {tab === 'projects' ? (
          <div className="mt-8 grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="space-y-2 border border-line bg-white/70 p-3">
              <button
                type="button"
                className="w-full border border-line px-3 py-2 text-sm font-semibold hover:bg-bg-elevated"
                onClick={addProject}
              >
                + Add project
              </button>
              {projects.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  className={`w-full border px-3 py-2 text-left text-sm ${
                    selectedSlug === p.slug
                      ? 'border-sage bg-sage/10 font-semibold'
                      : 'border-line hover:bg-bg-elevated'
                  }`}
                  onClick={() => setSelectedSlug(p.slug)}
                >
                  {p.title || p.slug}
                </button>
              ))}
            </div>

            {selected ? (
              <div className="space-y-5 border border-line bg-white/70 p-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg-elevated"
                    onClick={() => moveProject(selected.slug, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg-elevated"
                    onClick={() => moveProject(selected.slug, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                    onClick={() => removeProject(selected.slug)}
                  >
                    Delete project
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Title">
                    <input
                      className={inputClass}
                      value={selected.title}
                      onChange={(e) => {
                        const title = e.target.value
                        const nextSlug = selected.slug.startsWith('project-')
                          ? slugify(title) || selected.slug
                          : selected.slug
                        setProjects((prev) =>
                          prev.map((p) =>
                            p.slug === selected.slug
                              ? { ...p, title, slug: nextSlug }
                              : p,
                          ),
                        )
                        if (nextSlug !== selected.slug) setSelectedSlug(nextSlug)
                      }}
                    />
                  </Field>
                  <Field label="Slug (URL)">
                    <input
                      className={inputClass}
                      value={selected.slug}
                      onChange={(e) => {
                        const nextSlug = slugify(e.target.value) || selected.slug
                        setProjects((prev) =>
                          prev.map((p) =>
                            p.slug === selected.slug ? { ...p, slug: nextSlug } : p,
                          ),
                        )
                        setSelectedSlug(nextSlug)
                      }}
                    />
                  </Field>
                  <Field label="Summary">
                    <textarea
                      className={areaClass}
                      value={selected.summary}
                      onChange={(e) => updateSelected({ summary: e.target.value })}
                    />
                  </Field>
                  <div className="grid gap-4">
                    <Field label="Status">
                      <select
                        className={inputClass}
                        value={selected.status ?? 'completed'}
                        onChange={(e) =>
                          updateSelected({
                            status: e.target.value as Project['status'],
                          })
                        }
                      >
                        <option value="in-progress">in-progress</option>
                        <option value="completed">completed</option>
                      </select>
                    </Field>
                    <Field label="Year / dates">
                      <input
                        className={inputClass}
                        value={selected.year ?? ''}
                        onChange={(e) => updateSelected({ year: e.target.value })}
                      />
                    </Field>
                    <Field label="Tags (comma-separated)">
                      <input
                        className={inputClass}
                        value={(selected.tags ?? []).join(', ')}
                        onChange={(e) =>
                          updateSelected({
                            tags: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Field label="Cover image (listings only)">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          void handleUpload(e.target.files?.[0] ?? null, 'cover')
                        }
                      />
                    </Field>
                    <p className="mt-1 text-xs text-ink-muted">
                      Used on project cards. Not shown at the top of the project page. If
                      empty, the 3D model is used as the cover when available.
                    </p>
                    {selected.coverImage ? (
                      <div className="mt-2 space-y-2">
                        <img
                          src={selected.coverImage}
                          alt=""
                          className="max-h-40 border border-line object-cover"
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            className="text-xs font-semibold text-red-700"
                            onClick={() =>
                              updateSelected({
                                coverImage: '',
                                hideCoverFromGallery: false,
                              })
                            }
                          >
                            Remove cover
                          </button>
                          <label className="flex items-center gap-2 text-xs text-ink-muted">
                            <input
                              type="checkbox"
                              checked={Boolean(selected.hideCoverFromGallery)}
                              onChange={(e) =>
                                updateSelected({
                                  hideCoverFromGallery: e.target.checked,
                                })
                              }
                            />
                            Hide cover from gallery
                          </label>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-ink-muted">
                        No cover set
                        {selected.model ? '. listings will show the 3D model.' : '.'}
                      </p>
                    )}
                  </div>
                  <div>
                    <Field label="Add gallery image">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          void handleUpload(e.target.files?.[0] ?? null, 'gallery')
                        }
                      />
                    </Field>
                    <ul className="mt-2 space-y-2">
                      {(selected.gallery ?? []).map((src) => {
                        const isCover = selected.coverImage === src
                        return (
                          <li
                            key={src}
                            className="flex flex-wrap items-center gap-2 border border-line p-2"
                          >
                            <img src={src} alt="" className="h-12 w-16 object-cover" />
                            {isCover ? (
                              <span className="text-xs font-semibold text-sage">Cover</span>
                            ) : null}
                            <button
                              type="button"
                              className="text-xs font-semibold text-sage-deep disabled:opacity-50"
                              disabled={isCover}
                              onClick={() =>
                                updateSelected({
                                  coverImage: src,
                                  hideCoverFromGallery:
                                    selected.hideCoverFromGallery ?? true,
                                })
                              }
                            >
                              {isCover ? 'Already cover' : 'Use as cover'}
                            </button>
                            <button
                              type="button"
                              className="text-xs font-semibold text-red-700"
                              onClick={() =>
                                updateSelected({
                                  gallery: (selected.gallery ?? []).filter((g) => g !== src),
                                  ...(isCover
                                    ? { coverImage: '', hideCoverFromGallery: false }
                                    : {}),
                                })
                              }
                            >
                              Remove
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>

                <div>
                  <Field label="3D model (.glb)">
                    <input
                      type="file"
                      accept=".glb,model/gltf-binary"
                      onChange={(e) =>
                        void handleUpload(e.target.files?.[0] ?? null, 'model')
                      }
                    />
                  </Field>
                  {selected.model ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                      <a
                        href={selected.model}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-sage-deep underline"
                      >
                        Current model
                      </a>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-700"
                        onClick={() => updateSelected({ model: '' })}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-muted">
                      Export GLB from Fusion / Onshape, then upload here.
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    YouTube videos
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      className={`${inputClass} max-w-md`}
                      placeholder="YouTube URL or video id"
                      value={youtubeInput}
                      onChange={(e) => setYoutubeInput(e.target.value)}
                    />
                    <button
                      type="button"
                      className="border border-line px-3 py-2 text-sm font-semibold hover:bg-bg-elevated"
                      onClick={addYoutube}
                    >
                      Add video
                    </button>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {(selected.videos ?? []).map((video, index) => (
                      <li
                        key={`${video.type}-${index}`}
                        className="flex items-center justify-between gap-3 border border-line px-3 py-2 text-sm"
                      >
                        <span>
                          {video.type === 'youtube'
                            ? `YouTube: ${video.id}`
                            : `File: ${video.src}`}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700"
                          onClick={() =>
                            updateSelected({
                              videos: (selected.videos ?? []).filter((_, i) => i !== index),
                            })
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Write-up sections
                    </p>
                    <button
                      type="button"
                      className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg-elevated"
                      onClick={() =>
                        updateSelected({
                          sections: [...(selected.sections ?? []), newSection()],
                        })
                      }
                    >
                      + Add section
                    </button>
                  </div>
                  <div className="mt-3 space-y-4">
                    {(selected.sections ?? []).map((section, index) => (
                      <div key={section.id} className="border border-line p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className={inputClass}
                            value={section.title}
                            onChange={(e) => {
                              const sections = [...(selected.sections ?? [])]
                              sections[index] = {
                                ...section,
                                title: e.target.value,
                              }
                              updateSelected({ sections })
                            }}
                          />
                          <button
                            type="button"
                            className="text-xs font-semibold text-red-700"
                            onClick={() =>
                              updateSelected({
                                sections: (selected.sections ?? []).filter(
                                  (_, i) => i !== index,
                                ),
                              })
                            }
                          >
                            Remove section
                          </button>
                        </div>
                        <textarea
                          className={`${areaClass} mt-2`}
                          value={section.body}
                          onChange={(e) => {
                            const sections = [...(selected.sections ?? [])]
                            sections[index] = { ...section, body: e.target.value }
                            updateSelected({ sections })
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="border border-line bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={saving}
                  onClick={() => void handleSaveProjects()}
                >
                  {saving ? 'Saving…' : 'Save projects'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Add a project to get started.</p>
            )}
          </div>
        ) : null}
      </div>
    </AdminTimezoneProvider>
  )
}
