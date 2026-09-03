import { Link, NavLink } from 'react-router-dom'
import { hasValue, siteContent } from '../lib/content'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/projects', label: 'Projects' },
  { to: '/about', label: 'About' },
  { to: '/resume', label: 'Resume' },
  { to: '/contact', label: 'Contact' },
]

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
}

export function Navbar() {
  const linkedInUrl = siteContent.links.linkedin.trim()
  const hasLinkedIn = hasValue(linkedInUrl)

  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4 md:px-8">
        <NavLink
          to="/"
          className="font-display text-xl font-semibold tracking-tight text-ink transition-colors hover:text-sage-deep"
        >
          {siteContent.name}
        </NavLink>
        <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm font-medium text-ink-muted">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                ['nav-link', isActive ? 'nav-link-active' : ''].filter(Boolean).join(' ')
              }
            >
              {link.label}
            </NavLink>
          ))}
          {hasLinkedIn ? (
            <a
              href={linkedInUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="LinkedIn"
              title="LinkedIn"
              className="nav-icon text-ink-muted"
            >
              <LinkedInIcon className="h-5 w-5" />
            </a>
          ) : (
            <Link
              to="/about"
              aria-label="LinkedIn (links to About for now)"
              title="LinkedIn — opens About until your profile URL is set"
              className="nav-icon text-ink-muted"
            >
              <LinkedInIcon className="h-5 w-5" />
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
