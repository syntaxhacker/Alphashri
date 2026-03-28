import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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
        <Route path="/chart/:symbol?" element={<ChartView />} />
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
