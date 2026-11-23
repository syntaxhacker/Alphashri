import { Show, Suspense, createEffect, createSignal, lazy, type JSX } from "solid-js";
import { Center, Loader } from "@/ui";
import { Navigate, Route, Router, useLocation } from "@solidjs/router";
import { AuthProvider, useAuth } from "./components/auth/AuthProvider";
import { LoginForm, RegisterForm } from "./components/auth/LoginForm";
import { NotificationContainer } from "./components/notifications/NotificationContainer";
import { PreviewChartProvider } from "./components/common/PreviewChartProvider";
import { SymbolDockProvider } from "./components/common/SymbolDockProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AppLayout } from "./components/layout/AppLayout";
import { NewsWebSocketProvider } from "./state/newsWebSocket";
import { loadHolidays } from "./state/holidays";

const HomePage = lazy(() => import("./pages/home/HomePage"));
const ScreenerContainer = lazy(() => import("./pages/screener/ScreenerContainer").then(m => ({ default: m.ScreenerContainer })));
const SectorPage = lazy(() => import("./pages/sector").then(m => ({ default: m.SectorPage })));
const StrategiesContainer = lazy(() => import("./pages/strategies/StrategiesContainer").then(m => ({ default: m.StrategiesContainer })));
const BacktestPage = lazy(() => import("./pages/backtest").then(m => ({ default: m.BacktestPage })));
const ExperimentsPage = lazy(() => import("./pages/experiments").then(m => ({ default: m.ExperimentsPage })));
const PaperTradingView = lazy(() => import("./pages/paper").then(m => ({ default: m.PaperTradingView })));
const ReplayPage = lazy(() => import("./pages/replay").then(m => ({ default: m.ReplayPage })));
const StrategyRunnerPage = lazy(() => import("./pages/strategy-runner").then(m => ({ default: m.StrategyRunnerPage })));
const BotsPage = lazy(() => import("./pages/bots").then(m => ({ default: m.BotsPage })));
const OptionsContainer = lazy(() => import("./pages/options/OptionsContainer").then(m => ({ default: m.OptionsContainer })));
const OptionsAnalyticsPage = lazy(() => import("./pages/options/OptionsAnalyticsPage"));
const OptionsReplayPage = lazy(() => import("./pages/options-replay/OptionsReplayPage").then(m => ({ default: m.OptionsReplayPage })));
const NiftyReportPage = lazy(() => import("./pages/report/NiftyReportShell").then(m => ({ default: m.NiftyReportShell })));
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then(m => ({ default: m.SettingsPage })));
const ChartView = lazy(() => import("./pages/chart/ChartView"));
const NewsPage = lazy(() => import("./pages/NewsPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const AgriContainer = lazy(() => import("./pages/agri/AgriContainer").then(m => ({ default: m.AgriContainer })));
const PatternsContainer = lazy(() => import("./pages/patterns/PatternsContainer").then(m => ({ default: m.PatternsContainer })));
const ProfitabilityPage = lazy(() => import("./pages/report/Profitability").then(m => ({ default: m.ProfitabilityPage })));
const SmcPoc = lazy(() => import("./pages/poc/SmcPoc"));
const KitPoc = lazy(() => import("./pages/poc/KitPoc").then((m) => ({ default: m.KitPoc })));
const SmcTrades = lazy(() => import("./pages/poc/SmcTrades"));
const TickReplay = lazy(() => import("./pages/poc/TickReplay"));
const ReplayStrategyPage = lazy(() => import("./pages/poc/ReplayStrategyPage"));
const ReplayIndexPage = lazy(() => import("./pages/poc/ReplayIndexPage"));

/**
 * `/` is a back-compat alias. A legacy `?tab=` becomes a path segment so every
 * old screener link converges on `/screener/<tab>`; the remaining query (and the
 * hash) are preserved.
 */
function RootRedirect() {
  const location = useLocation();
  const incoming = new URLSearchParams(location.search);
  const legacyTab = incoming.get("tab");
  if (legacyTab) {
    incoming.delete("tab");
    const rest = incoming.toString();
    return (
      <Navigate
        href={`/screener/${encodeURIComponent(legacyTab)}${rest ? `?${rest}` : ""}${location.hash}`}
      />
    );
  }
  return <Navigate href={`/screener${location.search}${location.hash}`} />;
}

function AuthScreen() {
  const [showRegister, setShowRegister] = createSignal(false);

  return (
    <Show
      when={showRegister()}
      fallback={<LoginForm onSwitchToRegister={() => setShowRegister(true)} />}
    >
      <RegisterForm onSwitchToLogin={() => setShowRegister(false)} />
    </Show>
  );
}

/**
 * Layout wrapper for every authenticated route. `props.children` is the
 * matched route, supplied by the router.
 */
function Shell(props: { children?: JSX.Element }) {
  return (
    <AppLayout>
      <PreviewChartProvider>
        <SymbolDockProvider>
          <Suspense fallback={<Center><Loader /></Center>}>
            <ErrorBoundary label="Page">{props.children}</ErrorBoundary>
          </Suspense>
        </SymbolDockProvider>
      </PreviewChartProvider>
      <NotificationContainer />
    </AppLayout>
  );
}

function AppContent() {
  // No destructuring: the auth context exposes getters, and destructuring
  // would copy each value once instead of reading it live.
  const auth = useAuth();

  createEffect(() => {
    const user = auth.user;
    if (user) {
      (window as any).__ALPHASHRI_USER__ = {
        displayName: user.display_name || user.email?.split("@")[0] || "User",
        email: user.email,
      };
      (window as any).handleLogout = auth.logout;
    } else {
      (window as any).__ALPHASHRI_USER__ = null;
    }
  });

  createEffect(() => {
    loadHolidays(new Date().getFullYear());
  });

  return (
    <Show
      when={!auth.loading}
      fallback={
        <Center className="auth-loading">
          <Loader size="sm" />
        </Center>
      }
    >
      <Show when={auth.isAuthenticated} fallback={<AuthScreen />}>
        <Router root={Shell}>
          <Route path="/" component={RootRedirect} />
          <Route path="/home" component={HomePage} />
          <Route path="/screener/:tab?" component={ScreenerContainer} />
          <Route path="/backtest" component={BacktestPage} />
          <Route path="/experiments" component={ExperimentsPage} />
          <Route path="/paper" component={PaperTradingView} />
          <Route path="/replay" component={ReplayPage} />
          <Route path="/strategy-runner" component={StrategyRunnerPage} />
          <Route path="/sector" component={SectorPage} />
          <Route path="/strategies" component={StrategiesContainer} />
          <Route path="/bots" component={BotsPage} />
          <Route path="/options/analytics/:symbol" component={OptionsAnalyticsPage} />
          <Route path="/options/replay/:positionId" component={OptionsReplayPage} />
          <Route path="/options/replay" component={OptionsReplayPage} />
          <Route path="/options" component={OptionsContainer} />
          <Route path="/report/nifty" component={() => <Navigate href="/report/index" />} />
          <Route path="/report/index" component={NiftyReportPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/news" component={NewsPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/agri" component={AgriContainer} />
          <Route path="/patterns" component={PatternsContainer} />
          <Route path="/report" component={() => <Navigate href="/screener" />} />
          <Route path="/report/profit" component={ProfitabilityPage} />
          <Route path="/poc/kit" component={KitPoc} />
          <Route path="/poc/smc" component={SmcPoc} />
          <Route path="/poc/smc-trades" component={SmcTrades} />
          <Route path="/poc/tick-replay" component={TickReplay} />
          <Route path="/poc/replay" component={ReplayIndexPage} />
          <Route path="/poc/replay/:strategyId" component={ReplayStrategyPage} />
          <Route path="/chart/:symbol?" component={ChartView} />
          <Route path="*" component={() => <Navigate href="/screener" />} />
        </Router>
      </Show>
    </Show>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <NewsWebSocketProvider>
        <AppContent />
      </NewsWebSocketProvider>
    </AuthProvider>
  );
}