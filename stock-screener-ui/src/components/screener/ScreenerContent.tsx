import { Show, For, createMemo } from "solid-js";
import { Stack, Button, CopyButton } from "@/ui";
import { IconCopy, IconCheck } from "./icons";
import { ScreenerEmpty } from "./ScreenerEmpty";
import { ScreenerLoading } from "./ScreenerLoading";
import { ScreenerErrorPanel } from "./ScreenerErrorPanel";
import { ScreenerSection } from "./ScreenerSection";
import { getColumnsForScreener } from "./columns";
import { subscribe, profileMetaById } from "../../state";
import { useStoreSnapshot } from "../../hooks/useStoreSubscription";
import type { Stock } from "../../types";

function approachRank(stock: Stock): number {
  if (stock.approach_type === "fresh") return 0;
  if (stock.approach_type === "retest") return 2;
  return 1;
}

function CopySymbolsAction(props: { stocks: Stock[]; testId: string }) {
  const value = () => props.stocks.map((s) => s.symbol).join(",");
  return (
    <CopyButton value={value()}>
      {({ copied, copy }) => (
        <Button
          size="xs"
          variant="subtle"
          color={copied ? "success" : "secondary"}
          onClick={copy}
          data-testid={props.testId}
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "TV symbols"}
        </Button>
      )}
    </CopyButton>
  );
}

interface SectionConfig {
  key: "approaching" | "touched";
  stocks: Stock[];
  label: string;
  description: string;
  columns: ReturnType<typeof getColumnsForScreener>;
  touchedSymbols: Set<string>;
  copyTestId: string;
}

interface Props {
  approachingStocks: Stock[];
  touchedStocks: Stock[];
  isLoading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onSymbolClick: (symbol: string) => void;
  onSymbolHover: (symbol: string | null) => void;
  activeScreener: string;
}

export function ScreenerContent(props: Props) {
  const store = useStoreSnapshot(subscribe, () => profileMetaById);
  const meta = () => store()[props.activeScreener];
  const scoreFormula = () => meta()?.score_formula || "";

  const sections = createMemo<SectionConfig[]>(() => {
    const m = meta();
    const sl = m?.section_labels;
    const sd = m?.section_descriptions;
    const result: SectionConfig[] = [];

    if (props.approachingStocks.length > 0) {
      // Fresh approaches first, then unknown, then retests (stable within groups).
      const ordered = [...props.approachingStocks].sort((a, b) => approachRank(a) - approachRank(b));
      result.push({
        key: "approaching",
        stocks: ordered,
        label: `${(sl?.primary || "Primary")} (${props.approachingStocks.length})`,
        description: sd?.primary || "",
        columns: getColumnsForScreener(props.activeScreener, "approaching"),
        touchedSymbols: new Set<string>(),
        copyTestId: "copy-approaching-symbols",
      });
    }
    if (props.touchedStocks.length > 0) {
      result.push({
        key: "touched",
        stocks: props.touchedStocks,
        label: `${(sl?.secondary || "Secondary")} (${props.touchedStocks.length})`,
        description: sd?.secondary || "",
        columns: getColumnsForScreener(props.activeScreener, "touched"),
        touchedSymbols: new Set(props.touchedStocks.map((stock) => stock.symbol)),
        copyTestId: "copy-touched-symbols",
      });
    }
    return result;
  });

  const hasResults = () => sections().length > 0;
  const showLoading = () => props.isLoading && !hasResults();
  const showError = () => !!props.error && !showLoading();
  const showEmpty = () => !showLoading() && !showError() && !hasResults();

  // Loading / error / empty are mutually-exclusive content states: each replaces
  // the table region rather than sitting above it. Unlike the inline-filter band,
  // none is an additive 0↔N row that pushes a visible table down, so no height
  // reservation is needed here — they are transient by design.
  return (
    <Show when={!showLoading()} fallback={<ScreenerLoading />}>
      <Show when={!showError()} fallback={<ScreenerErrorPanel error={props.error ?? ""} onRefresh={props.onRefresh} />}>
        <Show
          when={!showEmpty()}
          fallback={<ScreenerEmpty />}
        >
          <Stack gap={8} w="100%" p={0} className="flex min-h-0 items-stretch">
            <For each={sections()}>
              {(section) => (
                <ScreenerSection
                  title={section.label}
                  description={section.description}
                  testId={`screener-${section.key}-section`}
                  stocks={section.stocks}
                  columns={section.columns}
                  badgeLabel={undefined}
                  scoreFormula={scoreFormula()}
                  action={<CopySymbolsAction stocks={section.stocks} testId={section.copyTestId} />}
                  touchedSymbols={section.touchedSymbols}
                  onSymbolClick={props.onSymbolClick}
                  onSymbolHover={props.onSymbolHover}
                  section={section.key}
                  tableId={`screener.${props.activeScreener}.${section.key}`}
                />
              )}
            </For>
          </Stack>
        </Show>
      </Show>
    </Show>
  );
}
