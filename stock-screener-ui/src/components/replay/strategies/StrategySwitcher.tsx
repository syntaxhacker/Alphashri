// StrategySwitcher — in-page strategy picker. Lists every registered replay plugin
// and navigates to its /poc/replay/{id} shell. Keeps the replay pages switchable
// without leaving the feature (the legacy /poc/tick-replay route is one strategy).
import { useContext } from "solid-js";
import { RouterContext, useNavigate } from "@solidjs/router";
import { Select } from "@/ui";
import { listStrategies } from "./index";

function SwitcherSelect(props: { currentId: string }) {
  const navigate = useNavigate();
  const strategies = listStrategies();

  return (
    <Select
      size="sm"
      w={220}
      label="Strategy"
      value={props.currentId}
      onChange={(v) => {
        const id = v ?? "";
        if (id !== props.currentId) navigate(`/poc/replay/${id}`);
      }}
      data={strategies.map((s) => ({ value: s.id, label: s.label }))}
      data-testid="replay-strategy-switcher"
    />
  );
}

export default function StrategySwitcher(props: { currentId: string }) {
  // Only mounted when a Router is present so `useNavigate` is always in context.
  const router = useContext(RouterContext);
  if (!router) return null; // rendered outside a Router (unit tests) — no-op
  return <SwitcherSelect currentId={props.currentId} />;
}
