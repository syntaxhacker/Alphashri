import { useEffect, useMemo, useState } from "react";
import { Text } from "@/ui";
import { fetchThemeDetail } from "../../api/rotation";
import { MembersDrawer } from "@/components/common/MembersDrawer";
import type { ThemeDetailResponse } from "../../types/rotation";

export interface ThemeMembersDrawerProps {
  open: boolean;
  slug: string | null;
  name: string;
  onClose: () => void;
}

export function ThemeMembersDrawer({ open, slug, name, onClose }: ThemeMembersDrawerProps) {
  const [data, setData] = useState<ThemeDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || !slug) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    setQuery("");
    fetchThemeDetail(slug, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setData(response);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load theme members");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, slug]);

  const members = useMemo(() => {
    const all = data?.constituents ?? [];
    const term = query.trim().toUpperCase();
    return term ? all.filter((symbol) => symbol.toUpperCase().includes(term)) : all;
  }, [data, query]);

  const count = data?.theme.member_count ?? data?.constituents.length ?? 0;
  const title = data?.theme.name ?? name;
  const description = data?.theme.description ?? "";

  return (
    <MembersDrawer
      open={open}
      onClose={onClose}
      title={title || "Theme members"}
      subtitle={loading ? "Loading members…" : `${count} members${slug ? ` · ${slug}` : ""}`}
      description={description}
      symbols={members}
      loading={loading}
      error={error}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder="Filter members…"
      closeLabel="Close theme members"
      closeIconSize={15}
      width={520}
      gridMin={96}
      gridGap="2px"
      contentPx={1.25}
      headerGap={8}
      headerPy={0.5}
      footerGap={8}
      footerPy={0.5}
      bodyPx={0.25}
      searchStacked
      rowBordered={false}
      rowRadius="4px"
      symbolPy={0.25}
      ids={{
        drawer: "theme-members-drawer",
        close: "theme-members-close",
        search: "theme-members-search",
        row: (symbol) => `theme-member-${symbol}`,
        tv: (symbol) => `theme-member-tv-${symbol}`,
        chart: (symbol) => `theme-member-chart-${symbol}`,
      }}
      textSx={{
        title: { "font-size": 11 },
        subtitle: { display: "block", "font-size": 9 },
        description: { "font-size": 10 },
        symbol: { "font-size": 10.5, "line-height": 1.15 },
        loading: { "font-size": 10 },
        empty: { display: "block", py: 2, px: 0.25, "font-size": 10 },
      }}
      footerLeft={
        <Text c="dimmed" truncate className="text-[9.5px]">
          {members.length === count ? `${count} listed` : `${members.length} of ${count}`}
        </Text>
      }
      footerRight={
        <Text c="dimmed" className="text-[9.5px]">
          TV symbol · chart
        </Text>
      }
    />
  );
}
