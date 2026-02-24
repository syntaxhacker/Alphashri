import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { setCurrentView } from './state/backtest'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setCurrentView as setReduxView, type AppRouteView } from './store/appSlice'

function LegacyShell({ view }: { view: AppRouteView }) {
  const navigate = useNavigate()
  const location = useLocation()
  const dispatch = useAppDispatch()
  const currentReduxView = useAppSelector((state) => state.app.currentView)

  useEffect(() => {
    // Load existing non-React app once (it mounts into #legacy-root).
    void import('./legacy-main')
  }, [])

  useEffect(() => {
    dispatch(setReduxView(view))
    setCurrentView(view)
  }, [dispatch, view, location.pathname])

  useEffect(() => {
    ;(window as any).navigateToRoute = (nextView: AppRouteView) => {
      const path =
        nextView === 'backtest'
          ? '/backtest'
          : nextView === 'paper'
            ? '/paper'
            : nextView === 'sector'
              ? '/sector'
              : '/'
      if (location.pathname !== path) {
        navigate(path)
      }
    }
    return () => {
      delete (window as any).navigateToRoute
    }
  }, [navigate, location.pathname])

  return <div id="legacy-root" data-view={currentReduxView} />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LegacyShell view="screener" />} />
      <Route path="/backtest" element={<LegacyShell view="backtest" />} />
      <Route path="/paper" element={<LegacyShell view="paper" />} />
      <Route path="/sector" element={<LegacyShell view="sector" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
