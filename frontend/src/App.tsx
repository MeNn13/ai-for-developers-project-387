import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { BookingPage } from './pages/BookingPage'
import { HomePage } from './pages/HomePage'
import { OwnerPage } from './pages/OwnerPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/owner" element={<OwnerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
