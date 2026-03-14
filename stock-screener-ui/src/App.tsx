import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setCurrentView } from "./state/backtest";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { setCurrentView as setReduxView, type AppRouteView } from "./store/appSlice";
import ChartView from "./components/chart/ChartView";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider";
import { LoginForm, RegisterForm } from "./components/auth/LoginForm";
import { NotificationContainer } from "./components/NotificationContainer";
import { AppLayout } from "./components/layout/AppLayout";
import { SectorPage } from "./components/sector/SectorPage";
import { ScreenerContainer } from "./containers/ScreenerContainer";
import { StrategiesContainer } from "./containers/StrategiesContainer";
import { BacktestPage } from "./components/backtest/mantine";
import { PaperTradingView } from "./components/paper-trading/mantine";
import { BotsPage } from "./components/bots/mantine";
import { OptionsContainer } from "./components/options/OptionsContainer";
import { SettingsPage } from "./components/settings/SettingsPage";
import { NewsWebSocketProvider } from "./state/newsWebSocket";
import NewsPage from "./pages/NewsPage";
import AdminPage from "./pages/AdminPage";

// Wrapper for legacy views (backtest, paper, bots) that still use string-based HTML rendering
function LegacyShell({ view }: { view: AppRouteView }) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const currentReduxView = useAppSelector((state) => state.app.currentView);

  useEffect(() => {
    // Load legacy app once
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
                : nextView === "bots"
                  ? "/bots"
                  : "/";
      if (location.pathname !== path) {
        navigate(path);
      }
    };
    return () => {
      delete (window as any).navigateToRoute;
    };
  }, [navigate, location.pathname]);

  return (
    <div
      id="app-content"
      data-view={currentReduxView}
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    />
  );
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

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner"></div>
        <span>Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<ScreenerContainer />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/paper" element={<PaperTradingView />} />
        <Route path="/sector" element={<SectorPage />} />
        <Route path="/strategies" element={<StrategiesContainer />} />
        <Route path="/bots" element={<BotsPage />} />
        <Route path="/options" element={<OptionsContainer />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/news" element={<NewsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/chart/:symbol" element={<ChartView />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <NotificationContainer />
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NewsWebSocketProvider>
        <AppContent />
      </NewsWebSocketProvider>
    </AuthProvider>
  );
}
