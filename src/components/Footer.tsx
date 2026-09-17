import { Link } from 'react-router-dom'
import { usePortfolio } from '../lib/PortfolioContext'

export function Footer() {
  const { siteContent, hasValue } = usePortfolio()
  const phone = siteContent.phone.trim()
  const hasPhone = hasValue(phone)

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-8 text-sm text-ink-muted md:flex-row md:items-center md:justify-between md:px-8">
        <p>
          © {new Date().getFullYear()}{' '}
          <span className="font-medium text-ink">{siteContent.name}</span>
          {hasPhone ? (
            <>
              <span className="mx-2 text-line">·</span>
              <a
                href={`tel:${phone.replace(/\D/g, '')}`}
                className="transition-colors hover:text-sage"
              >
                {phone}
              </a>
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-5">
          <Link to="/projects" className="transition-colors hover:text-sage">
            Projects
          </Link>
          <Link to="/contact" className="transition-colors hover:text-sage">
            Contact
          </Link>
        </div>
      </div>
    </footer>
  )
}
