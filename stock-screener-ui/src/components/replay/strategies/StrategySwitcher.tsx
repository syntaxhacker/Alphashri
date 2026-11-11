// StrategySwitcher — in-page strategy picker. Lists every registered replay plugin
// and navigates to its /poc/replay/{id} shell. Keeps the replay pages switchable
// without leaving the feature (the legacy /poc/tick-replay route is one strategy).
import { useInRouterContext, useNavigate } from "react-router-dom";
import { Select } from "@/ui";
import { listStrategies } from "./index";

/** Only mounted when a Router is present so `useNavigate` is always in context. */
function SwitcherSelect({ currentId }: { currentId: string }) {
  const navigate = useNavigate();
  const strategies = listStrategies();

  return (
    <Select
      size="sm"
      w={220}
      label="Strategy"
      value={currentId}
      onChange={(v) => {
        const id = v ?? "";
        if (id !== currentId) navigate(`/poc/replay/${id}`);
      }}
      data={strategies.map((s) => ({ value: s.id, label: s.label }))}
      data-testid="replay-strategy-switcher"
    />
  );
}

export default function StrategySwitcher({ currentId }: { currentId: string }) {
  const inRouter = useInRouterContext();
  if (!inRouter) return null; // rendered outside a Router (unit tests) — no-op
  return <SwitcherSelect currentId={currentId} />;
}
