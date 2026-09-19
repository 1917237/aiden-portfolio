import { Navigate } from 'react-router-dom'

/** Legacy route. student schedule lives on the dashboard now. */
export function TutoringStudentClasses() {
  return <Navigate to="/tutoring/dashboard" replace />
}
