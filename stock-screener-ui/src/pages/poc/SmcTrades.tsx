// SMC iFVG — thin wrapper preserving the legacy /poc/smc-trades route + test entry.
// All behavior now lives in ReplayShell; this just binds the smc-ifvg strategy plugin.
import ReplayShell from "@/components/replay/core/ReplayShell";
import { getStrategy } from "@/components/replay/strategies";
import { PocScrollShell } from "./PocScrollShell";

export default function SmcTrades() {
  const plugin = getStrategy("smc-ifvg");
  if (!plugin) return null;
  return (
    <PocScrollShell testId="smc-trades-page" ariaLabel="SMC trades, scroll for charts and trades">
      <ReplayShell plugin={plugin} />
    </PocScrollShell>
  );
}
