import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { About } from './pages/About'
import { Contact } from './pages/Contact'
import { Home } from './pages/Home'
import { ProjectDetail } from './pages/ProjectDetail'
import { Projects } from './pages/Projects'
import { Resume } from './pages/Resume'
import { TutoringShell } from './pages/tutoring/TutoringShell'

const TutoringCalendar = lazy(() =>
  import('./pages/tutoring/TutoringCalendar').then((m) => ({ default: m.TutoringCalendar })),
)
const TutoringDashboard = lazy(() =>
  import('./pages/tutoring/TutoringDashboard').then((m) => ({ default: m.TutoringDashboard })),
)
const TutoringInsights = lazy(() =>
  import('./pages/tutoring/TutoringInsights').then((m) => ({ default: m.TutoringInsights })),
)
const TutoringStudents = lazy(() =>
  import('./pages/tutoring/TutoringStudents').then((m) => ({ default: m.TutoringStudents })),
)
const TutoringStudentClasses = lazy(() =>
  import('./pages/tutoring/TutoringStudentClasses').then((m) => ({
    default: m.TutoringStudentClasses,
  })),
)
const TutoringNotifications = lazy(() =>
  import('./pages/tutoring/TutoringNotifications').then((m) => ({
    default: m.TutoringNotifications,
  })),
)
const TutoringLogin = lazy(() =>
  import('./pages/tutoring/TutoringLogin').then((m) => ({ default: m.TutoringLogin })),
)
const TutoringResetPassword = lazy(() =>
  import('./pages/tutoring/TutoringResetPassword').then((m) => ({
    default: m.TutoringResetPassword,
  })),
)
const TutoringPortfolioAdmin = lazy(() =>
  import('./pages/tutoring/TutoringPortfolioAdmin').then((m) => ({
    default: m.TutoringPortfolioAdmin,
  })),
)

function TutoringFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink-muted">
      Loading…
    </div>
  )
}

function TutoringPage({ children }: { children: ReactNode }) {
  return (
    <TutoringShell>
      <Suspense fallback={<TutoringFallback />}>{children}</Suspense>
    </TutoringShell>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="tutoring/classes"
          element={
            <TutoringPage>
              <TutoringStudentClasses />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/notifications"
          element={
            <TutoringPage>
              <TutoringNotifications />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/login"
          element={
            <TutoringPage>
              <TutoringLogin />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/reset-password"
          element={
            <TutoringPage>
              <TutoringResetPassword />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/dashboard"
          element={
            <TutoringPage>
              <TutoringDashboard />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/calendar"
          element={
            <TutoringPage>
              <TutoringCalendar />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/students"
          element={
            <TutoringPage>
              <TutoringStudents />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/insights"
          element={
            <TutoringPage>
              <TutoringInsights />
            </TutoringPage>
          }
        />
        <Route
          path="tutoring/portfolio"
          element={
            <TutoringPage>
              <TutoringPortfolioAdmin />
            </TutoringPage>
          }
        />
        <Route path="tutoring" element={<Navigate to="/tutoring/login" replace />} />

        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:slug" element={<ProjectDetail />} />
          <Route path="about" element={<About />} />
          <Route path="resume" element={<Resume />} />
          <Route path="contact" element={<Contact />} />
          <Route path="contact/message" element={<Navigate to="/contact#message" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
