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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="tutoring/classes" element={<TutoringStudentClasses />} />
        <Route path="tutoring/notifications" element={<TutoringNotifications />} />
        <Route path="tutoring/login" element={<TutoringLogin />} />
        <Route path="tutoring/reset-password" element={<TutoringResetPassword />} />
        <Route path="tutoring/dashboard" element={<TutoringDashboard />} />
        <Route path="tutoring/calendar" element={<TutoringCalendar />} />
        <Route path="tutoring/students" element={<TutoringStudents />} />
        <Route path="tutoring/insights" element={<TutoringInsights />} />
        <Route path="tutoring" element={<Navigate to="/tutoring/login" replace />} />

        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:slug" element={<ProjectDetail />} />
          <Route path="about" element={<About />} />
          <Route path="resume" element={<Resume />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
