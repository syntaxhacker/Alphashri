import { lazy, Suspense, useEffect, useState } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider2";
import { LoginForm, RegisterForm } from "./components/auth/LoginForm2";
import { NotificationContainer } from "./components/notifications/NotificationContainer";
import { PreviewChartProvider } from "./components/common/PreviewChartProvider";
import { ChatPopup } from "./components/common/ChatPopup";
import { AppLayout } from "./components/layout/AppLayout";
import { NewsWebSocketProvider } from "./state/newsWebSocket";
import { loadHolidays } from "./state/holidays";

const ScreenerContainer = lazy(() => import("./pages/screener/ScreenerContainer"));
const SectorPage = lazy(() => import("./components/sector/SectorPage2"));
const StrategiesContainer = lazy(() => import("./pages/strategies/StrategiesContainer"));
const BacktestPage = lazy(() => import("./components/backtest/mantine"));
const PaperTradingView = lazy(() => import("./components/paper-trading/mantine"));
const ReplayPage = lazy(() => import("./components/replay/mantine"));
const StrategyRunnerPage = lazy(() => import("./components/strategy-runner/mantine"));
const BotsPage = lazy(() => import("./components/bots/mantine"));
const OptionsContainer = lazy(() => import("./pages/options/OptionsContainer"));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage"));
const ChartView = lazy(() => import("./pages/chart/ChartView"));
const NewsPage = lazy(() => import("./pages/NewsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const HeatmapPage = lazy(() => import("./pages/heatmap/HeatmapPage"));

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

  useEffect(() => {
    loadHolidays(new Date().getFullYear());
  }, []);

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
      <PreviewChartProvider>
        <Suspense fallback={<Center><Loader /></Center>}>
          <Routes>
            <Route path="/" element={<ScreenerContainer />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/paper" element={<PaperTradingView />} />
            <Route path="/replay" element={<ReplayPage />} />
            <Route path="/strategy-runner" element={<StrategyRunnerPage />} />
            <Route path="/sector" element={<SectorPage />} />
            <Route path="/strategies" element={<StrategiesContainer />} />
            <Route path="/bots" element={<BotsPage />} />
            <Route path="/options" element={<OptionsContainer />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/heatmap" element={<HeatmapPage />} />
            <Route path="/chart/:symbol?" element={<ChartView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </PreviewChartProvider>
      <NotificationContainer />
      <ChatPopup />
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
