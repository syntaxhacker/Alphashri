// TickReplay — thin wrapper preserving the legacy /poc/tick-replay route + test entry.
// All behavior now lives in ReplayShell; this just binds the vwap-orb strategy plugin.
import ReplayShell from "@/components/replay/core/ReplayShell";
import { getStrategy } from "@/components/replay/strategies";

export default function TickReplay() {
  const plugin = getStrategy("vwap-orb");
  if (!plugin) return null;
  return <ReplayShell plugin={plugin} />;
}
