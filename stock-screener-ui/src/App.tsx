import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setCurrentView } from "./state/backtest";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setCurrentView as setReduxView, type AppRouteView } from "./store/appSlice";
import NewsPanel from "./components/news/NewsPanel";
import ChartView from "./components/chart/ChartView";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider";
import { LoginForm, RegisterForm } from "./components/auth/LoginForm";

function LegacyShell({ view }: { view: AppRouteView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const currentReduxView = useAppSelector((state) => state.app.currentView);

  useEffect(() => {
    // Load existing non-React app once (it mounts into #legacy-root).
    void import("./legacy-main");
  }, []);

  useEffect(() => {
    dispatch(setReduxView(view));
    setCurrentView(view);
  }, [dispatch, view, location.pathname]);

  useEffect(() => {
    (window as any).navigateToRoute = (nextView: AppRouteView) => {
      const path =
        nextView === "backtest"
          ? "/backtest"
          : nextView === "paper"
            ? "/paper"
            : nextView === "sector"
              ? "/sector"
              : nextView === "strategies"
                ? "/strategies"
                : "/";
      if (location.pathname !== path) {
        navigate(path);
      }
    };
    return () => {
      delete (window as any).navigateToRoute;
    };
  }, [navigate, location.pathname]);

  return <div id="legacy-root" data-view={currentReduxView} />;
}

function AuthScreen() {
  const [showRegister, setShowRegister] = useState(false);

  return showRegister ? (
    <RegisterForm onSwitchToLogin={() => setShowRegister(false)} />
  ) : (
    <LoginForm onSwitchToRegister={() => setShowRegister(true)} />
  );
}

function AppContent() {
  const { isAuthenticated, loading, user, logout } = useAuth();

  // Update window user info for legacy sidemenu
  useEffect(() => {
    if (user) {
      (window as any).__ALPHASHRI_USER__ = {
        displayName: user.display_name || user.email?.split("@")[0] || "User",
        email: user.email,
      };
      (window as any).handleLogout = logout;
    } else {
      (window as any).__ALPHASHRI_USER__ = null;
    }
  }, [user, logout]);

  // Show loading spinner while checking auth
  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner"></div>
        <span>Loading...</span>
      </div>
    );
  }

  // Show auth screen if not authenticated
  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<LegacyShell view="screener" />} />
        <Route path="/backtest" element={<LegacyShell view="backtest" />} />
        <Route path="/paper" element={<LegacyShell view="paper" />} />
        <Route path="/sector" element={<LegacyShell view="sector" />} />
        <Route path="/strategies" element={<LegacyShell view="strategies" />} />
        <Route path="/chart/:symbol" element={<ChartView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NewsPanel />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
