import { Outlet } from 'react-router-dom'
import { PortfolioProvider } from '../lib/PortfolioContext'
import { AmbientBackground } from './AmbientBackground'
import { Footer } from './Footer'
import { Navbar } from './Navbar'

export function Layout() {
  return (
    <PortfolioProvider>
      <div className="portfolio-shell flex min-h-screen flex-col">
        <AmbientBackground />
        <Navbar />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </PortfolioProvider>
  )
}
