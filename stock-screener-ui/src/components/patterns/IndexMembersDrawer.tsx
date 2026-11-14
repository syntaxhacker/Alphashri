import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Text } from "@/ui";
import { fetchIndexMembers } from "@/api/chartPatterns";
import { MembersDrawer } from "@/components/common/MembersDrawer";
import type { IndexMembersResponse } from "@/types/chartPatterns";

export interface IndexMembersDrawerProps {
  open: boolean;
  indexId: string | null;
  onClose: () => void;
  onScanMembers?: (symbols: string[]) => void;
}

export function IndexMembersDrawer(props: IndexMembersDrawerProps) {
  const [data, setData] = createSignal<IndexMembersResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");

  createEffect(() => {
    const open = props.open;
    const indexId = props.indexId;
    if (!open || !indexId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setQuery("");
    fetchIndexMembers(indexId)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load index members");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    onCleanup(() => {
      active = false;
    });
  });

  const symbols = createMemo(() => {
    const all = data()?.symbols ?? [];
    const term = query().trim().toUpperCase();
    return term ? all.filter((symbol) => symbol.includes(term)) : all;
  });

  const count = () => data()?.count ?? 0;
  const scanDisabled = () => symbols().length === 0 || !props.onScanMembers;

  return (
    <MembersDrawer
      open={props.open}
      onClose={props.onClose}
      title="Index members"
      subtitle={data() ? `${data()!.label} · ${count()} stocks` : (props.indexId ?? "—")}
      symbols={symbols()}
      loading={loading()}
      error={error()}
      emptyNote={data() ? (data()!.note ?? "No members available") : "No members available"}
      query={query()}
      onQueryChange={setQuery}
      searchPlaceholder="Filter symbols…"
      closeLabel="Close index members"
      closeIconSize={16}
      width={560}
      gridMin={126}
      gridGap="4px"
      contentPx={1}
      headerGap={1}
      headerPy={0.75}
      footerGap={1}
      footerPy={0.75}
      bodyPx={0}
      rowBordered
      rowRadius={0.5}
      symbolPy={0.5}
      ids={{
        drawer: "index-members-drawer",
        close: "index-members-close",
        search: "index-members-search",
        error: "index-members-error",
        row: (symbol) => `index-member-row-${symbol}`,
        tv: (symbol) => `index-member-tv-${symbol}`,
        chart: (symbol) => `index-member-chart-${symbol}`,
      }}
      footerLeft={
        <Text size="xs" c="dimmed" truncate>
          {symbols().length === count() ? `${count()} listed` : `${symbols().length} of ${count()}`}
        </Text>
      }
      footerRight={
        <button
          type="button"
          onClick={() => {
            if (!scanDisabled()) {
              props.onScanMembers?.(symbols());
              props.onClose();
            }
          }}
          disabled={scanDisabled()}
          data-testid="index-members-scan"
          className="inline-flex h-6 items-center rounded-fin bg-fin-primary px-2 text-xs font-semibold text-fin-bg transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {`Scan members (${symbols().length})`}
        </button>
      }
    />
  );
}
