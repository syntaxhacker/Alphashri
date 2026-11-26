import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Text } from "@/ui";
import { fetchThemeDetail } from "../../api/rotation";
import { MembersDrawer } from "@/components/common/MembersDrawer";
import { useSymbolDock } from "../common/symbolDockContext";
import type { ThemeDetailResponse } from "../../types/rotation";

export interface ThemeMembersDrawerProps {
  open: boolean;
  slug: string | null;
  name: string;
  onClose: () => void;
}

export function ThemeMembersDrawer(props: ThemeMembersDrawerProps) {
  const dock = useSymbolDock();
  // MembersDrawer portals its rows to <body>, so a wrapper handler cannot see
  // their clicks. Intercept the chart affordance in the capture phase instead.
  onMount(() => {
    const interceptChartClick = (event: MouseEvent) => {
      if (!props.open) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('[data-testid^="theme-member-chart-"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      const symbol = decodeURIComponent((anchor.getAttribute("href") ?? "").replace(/^\/chart\//, ""));
      if (symbol) dock.open(symbol);
    };
    document.addEventListener("click", interceptChartClick, true);
    onCleanup(() => document.removeEventListener("click", interceptChartClick, true));
  });

  const [data, setData] = createSignal<ThemeDetailResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");

  createEffect(() => {
    const open = props.open;
    const slug = props.slug;
    if (!open || !slug) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    setLoading(true);
    setError(null);
    setData(null);
    setQuery("");
    fetchThemeDetail(slug, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load theme members");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
  });

  const members = createMemo(() => {
    const all = data()?.constituents ?? [];
    const term = query().trim().toUpperCase();
    return term ? all.filter((symbol) => symbol.toUpperCase().includes(term)) : all;
  });

  const count = () => data()?.theme.member_count ?? data()?.constituents.length ?? 0;
  const title = () => data()?.theme.name ?? props.name;
  const description = () => data()?.theme.description ?? "";

  return (
    <MembersDrawer
      open={props.open}
      onClose={props.onClose}
      title={title() || "Theme members"}
      subtitle={loading() ? "Loading members…" : `${count()} members${props.slug ? ` · ${props.slug}` : ""}`}
      description={description()}
      symbols={members()}
      loading={loading()}
      error={error()}
      query={query()}
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
        row: (symbol: string) => `theme-member-${symbol}`,
        tv: (symbol: string) => `theme-member-tv-${symbol}`,
        chart: (symbol: string) => `theme-member-chart-${symbol}`,
      }}
      footerLeft={
        <Text c="dimmed" truncate className="text-ui-micro">
          {members().length === count() ? `${count()} listed` : `${members().length} of ${count()}`}
        </Text>
      }
      footerRight={
        <Text c="dimmed" className="text-ui-micro">
          TV symbol · chart
        </Text>
      }
    />
  );
}
