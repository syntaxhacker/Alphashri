import { Show } from "solid-js";
import { useParams, useSearchParams } from "@solidjs/router";
import { Text } from "@/ui";
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
    <div
      className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden px-4"
      data-testid="options-replay-page"
    >
      <header
        className="flex w-full shrink-0 items-center justify-between gap-2 pt-1 max-[899px]:pl-[var(--app-mobile-nav-gutter,44px)]"
        data-testid="options-replay-header"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <Text size="lg" fw={700} data-testid="options-replay-title">
            Options replay
          </Text>
          <Text
            span
            size="xs"
            c="dimmed"
            data-testid="options-replay-description"
            title={DESCRIPTION}
          >
            {DESCRIPTION}
          </Text>
        </div>
      </header>

      {/* The panel owns the only vertical scrollport (its playback/chart body);
          the page shell stays fixed so the title never scrolls away. */}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden pb-1">
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
      </div>
    </div>
  );
}

export default OptionsReplayPage;
