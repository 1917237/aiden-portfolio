import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { About } from './pages/About'
import { Contact } from './pages/Contact'
import { Home } from './pages/Home'
import { ProjectDetail } from './pages/ProjectDetail'
import { Projects } from './pages/Projects'
import { Resume } from './pages/Resume'
import { TutoringCalendar } from './pages/tutoring/TutoringCalendar'
import { TutoringDashboard } from './pages/tutoring/TutoringDashboard'
import { TutoringInsights } from './pages/tutoring/TutoringInsights'
import { TutoringStudents } from './pages/tutoring/TutoringStudents'
import { TutoringStudentClasses } from './pages/tutoring/TutoringStudentClasses'
import { TutoringNotifications } from './pages/tutoring/TutoringNotifications'
import { TutoringLogin } from './pages/tutoring/TutoringLogin'
import { TutoringResetPassword } from './pages/tutoring/TutoringResetPassword'
import { TutoringPortfolioAdmin } from './pages/tutoring/TutoringPortfolioAdmin'
import { TutoringShell } from './pages/tutoring/TutoringShell'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="tutoring/classes"
          element={
            <TutoringShell>
              <TutoringStudentClasses />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/notifications"
          element={
            <TutoringShell>
              <TutoringNotifications />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/login"
          element={
            <TutoringShell>
              <TutoringLogin />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/reset-password"
          element={
            <TutoringShell>
              <TutoringResetPassword />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/dashboard"
          element={
            <TutoringShell>
              <TutoringDashboard />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/calendar"
          element={
            <TutoringShell>
              <TutoringCalendar />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/students"
          element={
            <TutoringShell>
              <TutoringStudents />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/insights"
          element={
            <TutoringShell>
              <TutoringInsights />
            </TutoringShell>
          }
        />
        <Route
          path="tutoring/portfolio"
          element={
            <TutoringShell>
              <TutoringPortfolioAdmin />
            </TutoringShell>
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
