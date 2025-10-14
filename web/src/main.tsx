// Overlay SSOT pipeline: preview → render (v2)
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { StudioPage } from './pages/studio/StudioPage'
import { ShortDetailsPage } from './pages/shorts/ShortDetailsPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/studio" replace /> },
      { path: 'studio', element: <StudioPage /> },
      { path: 'shorts/:jobId', element: <ShortDetailsPage /> },
    ],
  },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)


