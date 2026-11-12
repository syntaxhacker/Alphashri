import { useEffect, useMemo, useState } from "react";
import { Button, Text } from "@/ui";
import { fetchIndexMembers } from "@/api/chartPatterns";
import { MembersDrawer } from "@/components/common/MembersDrawer";
import type { IndexMembersResponse } from "@/types/chartPatterns";

export interface IndexMembersDrawerProps {
  open: boolean;
  indexId: string | null;
  onClose: () => void;
  onScanMembers?: (symbols: string[]) => void;
}

export function IndexMembersDrawer({
  open,
  indexId,
  onClose,
  onScanMembers,
}: IndexMembersDrawerProps) {
  const [data, setData] = useState<IndexMembersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
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
    return () => {
      active = false;
    };
  }, [open, indexId]);

  const symbols = useMemo(() => {
    const all = data?.symbols ?? [];
    const term = query.trim().toUpperCase();
    return term ? all.filter((symbol) => symbol.includes(term)) : all;
  }, [data, query]);

  const count = data?.count ?? 0;
  const scanDisabled = symbols.length === 0 || !onScanMembers;

  return (
    <MembersDrawer
      open={open}
      onClose={onClose}
      title="Index members"
      subtitle={data ? `${data.label} · ${count} stocks` : (indexId ?? "—")}
      symbols={symbols}
      loading={loading}
      error={error}
      emptyNote={data ? (data.note ?? "No members available") : "No members available"}
      query={query}
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
      textSx={{
        title: { "font-size": "0.875rem" },
        subtitle: { "font-size": "0.75rem" },
        symbol: { "font-size": 11, "line-height": 1.2 },
      }}
      footerLeft={
        <Text size="xs" c="dimmed" truncate>
          {symbols.length === count ? `${count} listed` : `${symbols.length} of ${count}`}
        </Text>
      }
      footerRight={
        <Button
          size="xs"
          variant="filled"
          onClick={() => {
            if (!scanDisabled) {
              onScanMembers?.(symbols);
              onClose();
            }
          }}
          disabled={scanDisabled}
          data-testid="index-members-scan"
        >
          {`Scan members (${symbols.length})`}
        </Button>
      }
    />
  );
}
