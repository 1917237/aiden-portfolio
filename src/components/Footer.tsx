import { Link } from 'react-router-dom'
import { siteContent } from '../lib/content'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-ink-muted md:flex-row md:items-center md:justify-between md:px-8">
        <p>
          © {new Date().getFullYear()} {siteContent.name}
        </p>
        <div className="flex flex-wrap gap-4">
          <Link to="/projects" className="hover:text-sage-deep">
            Projects
          </Link>
          <Link to="/contact" className="hover:text-sage-deep">
            Contact
          </Link>
        </div>
      </div>
    </footer>
  )
}
