import { Show } from "solid-js";
import { useParams, useSearchParams } from "@solidjs/router";
import { Text } from "@/ui";
import { CompactPage } from "@/components/common/compact";
import { ReplayPanel } from "./ReplayPanel";

const DESCRIPTION =
  "Backdate a structure, watch its payoff unfold, then keep it as an open paper position until expiry.";

export function OptionsReplayPage() {
  const params = useParams<{ positionId?: string }>();
  const [search] = useSearchParams<{ underlying?: string; expiry?: string }>();
  const positionId = () => {
    const raw = params.positionId;
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  return (
    <CompactPage
      gap={16}
      px={16}
      title={
        <Text size="lg" fw={700} data-testid="options-replay-title">
          Options replay
        </Text>
      }
      description={
        <Text span size="xs" c="dimmed" data-testid="options-replay-description" title={DESCRIPTION}>
          {DESCRIPTION}
        </Text>
      }
    >
      {/* Keyed on the route id so /replay/1 → /replay/2 remounts and reloads. */}
      <Show keyed when={positionId() ?? -1}>
        {(id) => (
          <ReplayPanel
            positionId={id > 0 ? id : null}
            hintUnderlying={search.underlying}
            hintExpiry={search.expiry}
          />
        )}
      </Show>
    </CompactPage>
  );
}

export default OptionsReplayPage;
