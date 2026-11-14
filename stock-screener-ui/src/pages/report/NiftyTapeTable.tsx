import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { NiftyGex, NiftyTape, NiftyTapeRow } from "@/types/niftyReport";
import { hexToRgba } from "@/utils/color";
import { gexFlipAtSpot } from "./niftyGex";
import { getNiftyTapeColumns } from "./NiftyTapeColumns";
import { ascTapeByTime } from "./tapeRange";
import {
  TAPE_CALL_DOI,
  TAPE_CELL_RULE,
  TAPE_COL_RULE,
  TAPE_HEADER_RULE,
  TAPE_NEG_HUE,
  TAPE_NET_HUE,
  TAPE_NET_TEXT,
  TAPE_POS_HUE,
  TAPE_PUT_DOI,
  TAPE_ROW_HOVER,
  TAPE_ROW_LATEST,
  TAPE_SPOT,
  TAPE_TERM_BG,
  TAPE_FLIP_NEG_TEXT,
  TAPE_FLIP_POS_TEXT,
  buildTapeHead,
  computeChangedCells,
  computeSpotDeltas,
  computeTapeScale,
  computeTapeSession,
  formatIstClock,
  formatTapeCompact,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  getTapeBaseline,
  tapeDoiLabel,
} from "./tapeFormat";
import {
  REPORT_FONT,
  REPORT_PAD,
  REPORT_RADIUS,
  REPORT_LINE_HEIGHT,
  REPORT_FONT_WEIGHT,
  REPORT_LETTER_SPACING,
} from "./reportTokens";

/**
 * The tape's public surface. The maths and the formatters live in
 * `./tapeFormat` and the column model in `./NiftyTapeColumns`; they are
 * re-exported here so the panel (and its test) has one import path.
 */
export {
  TAPE_CALL_DOI,
  TAPE_FLIP_NEG_TEXT,
  TAPE_FLIP_POS_TEXT,
  TAPE_NEG_HUE,
  TAPE_NET_HUE,
  TAPE_NET_TEXT,
  TAPE_POS_HUE,
  TAPE_PUT_DOI,
  TAPE_SPOT,
  TAPE_TERM_BG,
  TAPE_TICK_NEG,
  TAPE_TICK_POS,
  TAPE_FLASH_FIELDS,
  buildTapeHead,
  computeChangedCells,
  computeSpotDeltas,
  computeTapeScale,
  computeTapeSession,
  formatIstClock,
  formatTapeBaseline,
  formatTapeCompact,
  formatTapePct,
  formatTapePrice,
  formatTapeRatio,
  formatTapeSigned,
  formatTapeTime,
  getTapeBaseline,
  tapeDoiLabel,
  tapeHeat,
} from "./tapeFormat";
export type { TapeScale } from "./tapeFormat";
export { getNiftyTapeColumns } from "./NiftyTapeColumns";

/**
 * Cheap serialised signature of the live change-flash map. The flash map only
 * ever holds genuinely moved cells (tiny), so this string is cheap to build
 * and lets the column model keep a stable identity for equal content.
 */
function serializeChangedCells(changed: Map<string, Set<string>>): string {
  if (changed.size === 0) return "";
  const parts: string[] = [];
  changed.forEach((set, t) => parts.push(`${t}:${[...set].sort().join(",")}`));
  parts.sort();
  return parts.join("|");
}

/**
 * Inverse of `serializeChangedCells`. Rebuilding the map from its canonical
 * string lets the column memo key on content instead of Map identity.
 *
 * Timestamps are `HH:MM`, so the split is on the LAST colon; column ids never
 * contain one.
 */
function deserializeChangedCells(key: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!key) return map;
  for (const part of key.split("|")) {
    if (!part) continue;
    const sep = part.lastIndexOf(":");
    if (sep < 0) continue;
    const cells = part.slice(sep + 1);
    map.set(part.slice(0, sep), new Set(cells ? cells.split(",") : []));
  }
  return map;
}

/** Stable row test-id getter — a module constant so the table never gets a new fn. */
function getTapeRowTestId(): string {
  return "nifty-tape-row";
}

/**
 * Static styles for the tape table wrap. The two `@keyframes` rules cannot be
 * Tailwind classes, so they render as a plain `<style>` tag.
 * Fixed px, not vh: vh balloons on tall monitors and squishes on short ones.
 * ~150px shows the header + ~6 rows; the rest scrolls inside TanStackTable's
 * own ScrollArea (the inner scroller — this wrap itself has no `overflow`).
 */
const TAPE_TABLE_WRAP_CLASS = [
  "flex min-h-[120px] h-[150px] min-w-0",
  // Terminal density: pitch-black surfaces pinned with !important over the
  // shared table's defaults.
  "[&_.paper-tanstack-container]:[background:var(--tape-bg)]! [&_.paper-tanstack-scroll]:[background:var(--tape-bg)]! [&_.paper-tanstack-table]:[background:var(--tape-bg)]!",
  `[&_.paper-tanstack-cell]:[padding-top:${REPORT_PAD.xs}px]! [&_.paper-tanstack-cell]:[padding-bottom:${REPORT_PAD.xs}px]! [&_.paper-tanstack-cell]:[background:var(--tape-bg)]! [&_.paper-tanstack-cell]:[border-bottom:1px_solid_${TAPE_CELL_RULE}]! [&_.paper-tanstack-cell]:text-[${REPORT_FONT.xs}px]! [&_.paper-tanstack-cell]:[font-family:var(--tape-mono)]!`,
  `[&_.paper-tanstack-header-cell]:[padding-top:${REPORT_PAD.xs}px]! [&_.paper-tanstack-header-cell]:[padding-bottom:${REPORT_PAD.xs}px]! [&_.paper-tanstack-header-cell]:[background:var(--tape-bg)]! [&_.paper-tanstack-header-cell]:[border-bottom:1px_solid_${TAPE_HEADER_RULE}]! [&_.paper-tanstack-header-cell]:[color:var(--tape-muted)]! [&_.paper-tanstack-header-cell]:text-[${REPORT_FONT.micro}px]! [&_.paper-tanstack-header-cell]:uppercase! [&_.paper-tanstack-header-cell]:align-bottom!`,
  // Thin rules group the OI-delta trio and the flip column so the tape reads
  // in blocks instead of one undifferentiated run.
  `[&_[id^='paper-tanstack-cell-put_doi-']]:[border-left:1px_solid_${TAPE_COL_RULE}]! [&_[id^='paper-tanstack-cell-net-']]:[border-left:1px_solid_${TAPE_COL_RULE}]! [&_[id^='paper-tanstack-cell-spot_flip-']]:[border-left:1px_solid_${TAPE_COL_RULE}]!`,
  // Row hover: lift the whole tape line so the eye can track across.
  `[&_tbody_tr[data-row='stock']:hover_.paper-tanstack-cell]:[background:${TAPE_ROW_HOVER}]!`,
  // Newest minute pinned with a blue left accent.
  `[&_tbody_tr.tape-latest_.paper-tanstack-cell]:[background:${TAPE_ROW_LATEST}]! [&_tbody_tr.tape-latest_.paper-tanstack-cell:first-of-type]:[box-shadow:inset_2px_0_0_0_var(--tape-call)]!`,
  // IST column stays put while the numeric block scrolls sideways.
  `[&_th:first-of-type]:sticky [&_th:first-of-type]:left-0 [&_th:first-of-type]:z-[3] [&_th:first-of-type]:[background:var(--tape-bg)]! [&_th:first-of-type]:[box-shadow:1px_0_0_0_${TAPE_COL_RULE}]!`,
  `[&_td:first-of-type]:sticky [&_td:first-of-type]:left-0 [&_td:first-of-type]:z-[2] [&_td:first-of-type]:[background:var(--tape-bg)]! [&_td:first-of-type]:[box-shadow:1px_0_0_0_${TAPE_COL_RULE}]!`,
  // OI-burst minutes get a coloured spine on the IST cell — the same
  // blue/orange language as the tape columns. Declared after the latest-row
  // rule so it wins on the newest minute.
  "[&_tbody_tr.tape-burst-call_.paper-tanstack-cell:first-of-type]:[box-shadow:inset_3px_0_0_0_var(--tape-call)]!",
  "[&_tbody_tr.tape-burst-put_.paper-tanstack-cell:first-of-type]:[box-shadow:inset_3px_0_0_0_var(--tape-put)]!",
  // Live tick animations (keyframes below).
  "[&_tbody_tr.tape-flash_.paper-tanstack-cell]:[animation:tapeRowFlash_1.5s_ease-out]",
  "[&_.tape-cell-flash]:[animation:tapeCellFlash_1.5s_ease-out]",
].join(" ");

const TAPE_TABLE_WRAP_STYLE = {
  background: TAPE_TERM_BG,
  "--tape-bg": TAPE_TERM_BG,
  "--tape-muted": palette.TEXT_MUTED,
  "--tape-mono": palette.MONO,
  "--tape-call": TAPE_CALL_DOI,
  "--tape-put": TAPE_PUT_DOI,
} as JSX.CSSProperties;

const TAPE_FLASH_KEYFRAMES = `@keyframes tapeRowFlash {
  0% { "box-shadow": inset 0 0 0 100px ${hexToRgba(TAPE_POS_HUE, 0.40)}; }
  100% { "box-shadow": inset 0 0 0 100px ${hexToRgba(TAPE_POS_HUE, 0)}; }
}
@keyframes tapeCellFlash {
  0% { "box-shadow": inset 0 0 0 100px ${hexToRgba(TAPE_SPOT, 0.45)}; }
  100% { "box-shadow": inset 0 0 0 100px ${hexToRgba(TAPE_SPOT, 0)}; }
}
@keyframes tapePulse {
  0% { opacity: 1; box-shadow: 0 0 0 0 ${hexToRgba(palette.POSITIVE, 0.5)}; }
  70% { opacity: 0.6; box-shadow: 0 0 0 5px ${hexToRgba(palette.POSITIVE, 0)}; }
  100% { opacity: 1; box-shadow: 0 0 0 0 ${hexToRgba(palette.POSITIVE, 0)}; }
}`;

export function NiftyTapeTable(props: {
  rows: NiftyTapeRow[];
  tape?: NiftyTape;
  /** Live mode: show the pulsing LIVE dot; EOD hides it. */
  live?: boolean;
  /** Minute → side that triggered an OI burst (marks the row with a spine). */
  bursts?: Map<string, "call" | "put">;
  /** Epoch ms of the last successful refresh, and of the next scheduled one. */
  updatedAtMs?: number | null;
  nextUpdateAtMs?: number | null;
  /**
   * The report's dealer-gamma block. When present the tape's flip comes from
   * `gexFlipAtSpot` (spot-relative, self-consistent with the gamma strip)
   * instead of the flip recorded with each row.
   */
  gex?: NiftyGex;
  /** Live spot used to place the flip; falls back to the tape's last spot. */
  spot?: number | null;
}) {
  const [order, setOrder] = createSignal<"newest" | "oldest">("newest");
  // Live tick feedback: which minute just arrived (row flash) and which
  // existing minutes had values revised (cell flash).
  const [flashT, setFlashT] = createSignal<string | null>(null);
  const [changed, setChanged] = createSignal<Map<string, Set<string>>>(new Map());
  let prevRows = new Map<string, NiftyTapeRow>();
  let prevLatest = "";
  let flashPending = false;

  const baseline = createMemo(() => getTapeBaseline(props.tape, props.rows));
  /** Newest-first (default) or oldest-first; `ascTapeByTime` returns a fresh
   * array, so the in-place reverse never touches the prop. */
  const ordered = createMemo(() => {
    const asc = ascTapeByTime(props.rows);
    return order() === "newest" ? asc.reverse() : asc;
  });
  const scale = createMemo(() => computeTapeScale(props.rows));
  const spotDeltas = createMemo(() => computeSpotDeltas(props.rows));
  // The column model embeds the live flash map in its cell closures. Keying
  // the memo on a cheap serialised signature (instead of the Map identity)
  // keeps the whole 12-column model stable across ticks whose flash content
  // is unchanged — a fresh-but-equal Map never rebuilds it.
  const changedKey = createMemo(() => serializeChangedCells(changed()));
  // Content-keyed identity: a fresh-but-equal Map keeps the previous instance,
  // so the 12-column model is not rebuilt on every tick.
  const stableChanged = createMemo(() => deserializeChangedCells(changedKey()));
  // The tape's own last spot is the fallback for the flip placement — the
  // recorded rows are the only spot the tape knows for sure.
  const tapeSpot = createMemo(() => {
    const asc = ascTapeByTime(props.rows);
    return asc.length > 0 ? asc[asc.length - 1].spot : null;
  });
  // Spot-relative gamma flip: the same level the gamma strip shows. Without
  // the gex block the tape keeps the flip recorded with its rows.
  const flipAtSpot = createMemo(() => {
    if (!props.gex) return null;
    const reference = Number.isFinite(props.spot as number) ? (props.spot as number) : tapeSpot();
    if (reference === null || !Number.isFinite(reference)) return null;
    return gexFlipAtSpot(props.gex, reference);
  });
  const columns = createMemo(() =>
    getNiftyTapeColumns(
      baseline() ?? undefined,
      scale(),
      spotDeltas(),
      stableChanged(),
      flipAtSpot(),
    ),
  );
  const head = createMemo(() => buildTapeHead(props.rows, props.tape, flipAtSpot()));
  const doiLabel = createMemo(() => tapeDoiLabel(props.tape, props.rows));
  const session = createMemo(() => computeTapeSession(props.rows));
  const flipSigned = () =>
    `${head().flipDeltaPts >= 0 ? "+" : ""}${head().flipDeltaPts.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts`;
  const latestT = () => {
    const o = ordered();
    if (o.length === 0) return "";
    return order() === "newest" ? o[0].t : o[o.length - 1].t;
  };

  // Diff each incoming snapshot against the previous one: a new minute →
  // row flash; a revised value on an existing minute → cell flash. Both
  // auto-clear after the animation window so nothing stays lit.
  // Perf: snapshots whose content did not move skip setState AND the 1.6s
  // clear timer entirely, so a quiescent tick costs one effect with no
  // second render. The timer only (re)starts while a flash is actually lit.
  createEffect(() => {
    const rows = props.rows;
    const latest = latestT();
    const prevLatestSnapshot = prevLatest;
    prevLatest = latest;
    const isNewLatest = Boolean(prevLatestSnapshot && latest && prevLatestSnapshot !== latest);
    if (isNewLatest) {
      setFlashT(latest);
    }
    // A brand-new minute is never in the previous snapshot, so it can't
    // appear here — the row flash covers it. Only genuine revisions flash.
    const moved = computeChangedCells(prevRows, rows);
    if (moved.size > 0) {
      setChanged(moved);
    }
    const snapshot = new Map<string, NiftyTapeRow>();
    for (const r of rows) snapshot.set(r.t, r);
    prevRows = snapshot;
    if (isNewLatest || moved.size > 0) {
      flashPending = true;
    }
    if (!flashPending) return;
    const id = setTimeout(() => {
      flashPending = false;
      setFlashT((prev) => (prev === null ? prev : null));
      setChanged((prev) => (prev.size === 0 ? prev : new Map()));
    }, 1600);
    onCleanup(() => clearTimeout(id));
  });

  const getRowClassName = (row: NiftyTapeRow) => {
    const cls: string[] = [];
    const side = props.bursts?.get(row.t);
    if (side === "call") cls.push("tape-burst-call");
    else if (side === "put") cls.push("tape-burst-put");
    if (row.t === flashT()) cls.push("tape-flash");
    else if (row.t === latestT()) cls.push("tape-latest");
    return cls.length > 0 ? cls.join(" ") : undefined;
  };

  const updatedStamp = () => props.updatedAtMs ?? null;

  return (
    // Fixed px chrome: root gaps are 4px; the table wrap below owns the only
    // height budget. No `overflow` on this root — it is not a page-column
    // child, but the rule stands: only inner scroll containers scroll.
    <div class="flex flex-col" style={{ gap: "4px", "min-width": "0", background: TAPE_TERM_BG }}>
      {/* Single wrapping stat line (was two stacked rows): PCR OI, ΔOI since
          baseline, max pain, flip, walls, then session meta + order toggle +
          LIVE dot all flow inline so the head is one ~18px line at width. */}
      <div
        data-testid="nifty-tape-head"
        class="min-w-0"
        style={{
          background: TAPE_TERM_BG,
          "padding-left": `${REPORT_PAD.sm / 8}px`,
          "padding-top": `${REPORT_PAD.xs / 8}px`,
        }}
      >
        <div
          class="flex items-center flex-wrap"
          style={{
            "column-gap": "12px",
            "row-gap": `${REPORT_PAD.xs / 8}px`,
            "font-variant-numeric": "tabular-nums",
          }}
        >
          <div data-testid="nifty-tape-pcr" class="flex items-baseline" style={{ gap: "4px" }}>
            <Text span fw={600} tt="uppercase" c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>PCR OI</Text>
            <Text span fw={700} data-testid="nifty-tape-head-pcr-oi" style={{ "font-size": `${REPORT_FONT.sm}px` }}>{formatTapeRatio(head().pcrOi)}</Text>
            <Text span c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>snapshot</Text>
          </div>
          <div data-testid="nifty-tape-head-pcr-doi" class="flex items-baseline" style={{ gap: "4px" }}>
            <Text span fw={600} tt="uppercase" c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>{doiLabel()}</Text>
            <Text span fw={700} c={TAPE_CALL_DOI} style={{ "font-size": `${REPORT_FONT.sm}px` }}>{formatTapeSigned(head().pcrDoiDelta)}</Text>
          </div>
          <div data-testid="nifty-tape-max-pain" class="flex items-baseline" style={{ gap: "4px" }}>
            <Text span fw={600} tt="uppercase" c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>Max pain</Text>
            <Text span fw={700} data-testid="nifty-tape-head-max-pain" style={{ "font-size": `${REPORT_FONT.sm}px` }}>{formatTapePrice(head().maxPain)}</Text>
          </div>
          <div data-testid="nifty-tape-flip" class="flex items-baseline" style={{ gap: "4px" }}>
            <Text span fw={600} tt="uppercase" c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>Flip</Text>
            <Text span fw={700} data-testid="nifty-tape-head-flip" style={{ "font-size": `${REPORT_FONT.sm}px` }}>
              {formatTapePrice(head().flip)}{" "}
              <Text span fw={700} c={head().flipDeltaPts >= 0 ? TAPE_FLIP_POS_TEXT : TAPE_FLIP_NEG_TEXT} style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>
                {flipSigned()}
              </Text>
            </Text>
            <Text span c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>spot−flip</Text>
          </div>
          <div data-testid="nifty-tape-walls" class="flex items-baseline" style={{ gap: "4px" }}>
            <Text span fw={600} tt="uppercase" c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>Walls</Text>
            <Text span fw={700} data-testid="nifty-tape-head-walls" style={{ "font-size": `${REPORT_FONT.sm}px` }}>
              {formatTapePrice(head().wallCall)} / {formatTapePrice(head().wallPut)}
            </Text>
            <Text span c="dimmed" style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>call / put</Text>
          </div>
          <Text c="dimmed" ta="left" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>
            TICKS {props.rows.length} · one per minute
          </Text>
          <Show when={updatedStamp()}>
            {(stamp) => (
              <Text
                data-testid="nifty-tape-updated"
                c="dimmed"
                span
                style={{ "font-variant-numeric": "tabular-nums", "font-size": `${REPORT_FONT.xs - 1}px` }}
              >
                upd {formatIstClock(stamp())}
                {props.nextUpdateAtMs !== null && props.nextUpdateAtMs !== undefined
                  ? ` · next ${formatIstClock(props.nextUpdateAtMs)}`
                  : ""}
              </Text>
            )}
          </Show>
          <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>
            SPOT {formatTapePrice(session().spotLo)}–{formatTapePrice(session().spotHi)}
          </Text>
          <div class="flex items-baseline" style={{ gap: "4px" }}>
            <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>MAX ΔOI</Text>
            <Text span fw={700} c={TAPE_CALL_DOI} style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>C {formatTapeCompact(session().maxCallDoi)}</Text>
            <Text span fw={700} c={TAPE_PUT_DOI} style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>P {formatTapeCompact(session().maxPutDoi)}</Text>
          </div>
          <div class="flex items-baseline" style={{ gap: "4px" }}>
            <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>NET</Text>
            <Text
              span
              fw={700}
              c={session().netLast >= 0 ? TAPE_NET_TEXT : TAPE_FLIP_NEG_TEXT}
              title="Cumulative put ΔOI − call ΔOI at the last recorded minute (the tape's `net` is already a running total — the column is never summed)"
              style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}
            >
              {formatTapeCompact(session().netLast)}
            </Text>
          </div>
          <Button
            data-testid="nifty-tape-order-toggle"
            variant="transparent"
            onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
            style={{
              border: `1px solid ${palette.TAPE_HEADER_RULE}`,
              background: "transparent",
              color: TAPE_CALL_DOI,
              "border-radius": "9999px",
              "padding-left": "8px",
              "padding-right": "8px",
              "padding-top": "0",
              "padding-bottom": "0",
              "font-size": `${REPORT_FONT.micro}px`,
              "font-weight": REPORT_FONT_WEIGHT.bold,
              cursor: "pointer",
              "letter-spacing": REPORT_LETTER_SPACING.normal,
            }}
          >
            {order() === "newest" ? "NEWEST FIRST ↓" : "OLDEST FIRST ↑"}
          </Button>
          <Show when={props.live}>
            <div
              data-testid="nifty-tape-live"
              class="flex items-center"
              style={{ gap: "4px" }}
            >
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  "border-radius": "50%",
                  "background-color": palette.POSITIVE,
                  animation: "tapePulse 1.8s ease-out infinite",
                }}
              />
              <Text span fw={700} c={palette.POSITIVE} style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>LIVE</Text>
            </div>
          </Show>
        </div>
      </div>
      <div
        data-testid="nifty-tape-table-wrap"
        class={TAPE_TABLE_WRAP_CLASS}
        style={TAPE_TABLE_WRAP_STYLE}
      >
        <style>{TAPE_FLASH_KEYFRAMES}</style>
        <TanStackTable<NiftyTapeRow>
          data={ordered()}
          columns={columns()}
          dataTestId="nifty-tape-table"
          emptyMessage="No tape rows yet"
          fillContainer
          enableSorting={false}
          rowWindowSize={40}
          dense
          getRowTestId={getTapeRowTestId}
          getRowClassName={getRowClassName}
        />
      </div>
      {/* One dense legend line: tight column gap + no row gap so it stays a
          single wrapped line instead of two airy rows. */}
      <div
        data-testid="nifty-tape-heat-legend"
        class="flex items-center flex-wrap"
        style={{
          "column-gap": "8px",
          "row-gap": "0",
          "padding-left": `${REPORT_PAD.sm / 8}px`,
          "padding-bottom": `${REPORT_PAD.xs / 8}px`,
          "line-height": REPORT_LINE_HEIGHT.snug,
        }}
      >
        <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>HEAT</Text>
        <div class="flex items-center" style={{ gap: "4px" }}>
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_POS_HUE, 0.18), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_POS_HUE, 0.45), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_POS_HUE, 0.7), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }} title="Positive value in the signed columns — net put-led, call/put tick volume up, PCR up, spot above the flip">positive</Text>
        </div>
        <div class="flex items-center" style={{ gap: "4px" }}>
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_NEG_HUE, 0.18), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_NEG_HUE, 0.45), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_NEG_HUE, 0.7), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }} title="Negative value in the signed columns — net call-led, call/put tick volume down, PCR down, spot below the flip">negative</Text>
        </div>
        <div class="flex items-center" style={{ gap: "4px" }}>
          <div style={{ width: "10px", height: "8px", background: hexToRgba(TAPE_NET_HUE, 0.7), "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>net ΔOI (put−call)</Text>
        </div>
        <div data-testid="nifty-tape-burst-legend" class="flex items-center" style={{ gap: "4px" }}>
          <div style={{ width: "10px", height: "8px", background: TAPE_CALL_DOI, "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <div style={{ width: "10px", height: "8px", background: TAPE_PUT_DOI, "border-radius": `${REPORT_RADIUS.sm / 2}px` }} />
          <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>burst minute</Text>
        </div>
        <Text c="dimmed" span style={{ "font-size": `${REPORT_FONT.xs - 1}px` }}>· brighter = bigger print</Text>
      </div>
    </div>
  );
}
