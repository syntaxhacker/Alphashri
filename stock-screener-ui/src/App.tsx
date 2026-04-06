import { useEffect, useState } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider2";
import { LoginForm, RegisterForm } from "./components/auth/LoginForm2";
import { NotificationContainer } from "./components/notifications/NotificationContainer";
import { AppLayout } from "./components/layout/AppLayout";
import { SectorPage } from "./components/sector/SectorPage2";
import { ScreenerContainer } from "./pages/screener/ScreenerContainer";
import { StrategiesContainer } from "./pages/strategies/StrategiesContainer";
import { BacktestPage } from "./components/backtest/mantine";
import { PaperTradingView } from "./components/paper-trading/mantine";
import { BotsPage } from "./components/bots/mantine";
import { OptionsContainer } from "./pages/options/OptionsContainer";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { NewsWebSocketProvider } from "./state/newsWebSocket";
import ChartView from "./pages/chart/ChartView";
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
      <Center className="auth-loading">
        <Loader size="sm" />
      </Center>
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
