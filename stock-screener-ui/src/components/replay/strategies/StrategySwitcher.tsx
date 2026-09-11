// StrategySwitcher — in-page strategy picker. Lists every registered replay plugin
// and navigates to its /poc/replay/{id} shell. Keeps the replay pages switchable
// without leaving the feature (the legacy /poc/tick-replay route is one strategy).
import { useInRouterContext, useNavigate } from "react-router-dom";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import { listStrategies } from "./index";

/** Only mounted when a Router is present so `useNavigate` is always in context. */
function SwitcherSelect({ currentId }: { currentId: string }) {
  const navigate = useNavigate();
  const strategies = listStrategies();

  return (
    <TextField
      size="small"
      select
      label="Strategy"
      value={currentId}
      onChange={(e) => {
        const id = e.target.value;
        if (id !== currentId) navigate(`/poc/replay/${id}`);
      }}
      sx={{ width: 220 }}
      inputProps={{ "aria-label": "replay strategy" }}
    >
      {strategies.map((s) => (
        <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
      ))}
    </TextField>
  );
}

export default function StrategySwitcher({ currentId }: { currentId: string }) {
  const inRouter = useInRouterContext();
  if (!inRouter) return null; // rendered outside a Router (unit tests) — no-op
  return <SwitcherSelect currentId={currentId} />;
}
