import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { TanStackTable } from "@/components/common/TanStackTable";
import type { NiftyGex, NiftyTape, NiftyTapeRow } from "@/types/niftyReport";
import { hexToRgba } from "@/utils/color";
import { gexFlipAtSpot } from "./niftyGex";
import { getNiftyTapeColumns } from "./NiftyTapeColumns";
import {
  TAPE_CALL_DOI,
  TAPE_NEG_HUE,
  TAPE_NET_HUE,
  TAPE_NET_TEXT,
  TAPE_POS_HUE,
  TAPE_PUT_DOI,
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
 * string lets the column memo key on content instead of Map identity without
 * disabling a hook rule — a suppressed `exhaustive-deps` makes React Compiler
 * skip the whole component (it refuses to optimise files that silence rules).
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
 * Static styles for the tape table wrap — hoisted so the `@keyframes`
 * tapeRowFlash / tapeCellFlash declarations (and every nested selector) keep
 * a stable identity instead of being re-allocated on every render.
 */
const TAPE_TABLE_WRAP_SX: SxProps<Theme> = {
  display: "flex",
  // Fixed px, not vh: vh balloons on tall monitors and squishes on
  // short ones. ~150px shows the header + ~6 rows; the rest scrolls
  // inside TanStackTable's own ScrollArea (the inner scroller — this
  // wrap itself has no `overflow`, so no flex-collapse risk).
  minHeight: 120,
  height: 150,
  minWidth: 0,
  background: TAPE_TERM_BG,
  // Terminal density: pitch-black surfaces, muted grid lines,
  // monospaced tabular numerals. Scoped descendant overrides only.
  "& .paper-tanstack-container, & .paper-tanstack-scroll, & .paper-tanstack-table": {
    background: `${TAPE_TERM_BG} !important`,
  },
  "& .paper-tanstack-cell": {
    paddingTop: "3px",
    paddingBottom: "3px",
    background: `${TAPE_TERM_BG} !important`,
    borderBottom: "1px solid #141414 !important",
    fontSize: 12,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
  "& .paper-tanstack-header-cell": {
    paddingTop: "3px",
    paddingBottom: "4px",
    background: `${TAPE_TERM_BG} !important`,
    borderBottom: "1px solid #2A2A2A !important",
    color: "#8B949E",
    fontSize: 10,
    textTransform: "uppercase",
    verticalAlign: "bottom",
  },
  // Thin rules group the OI-delta trio and the flip column so the
  // tape reads in blocks instead of one undifferentiated run.
  "& [id^='paper-tanstack-cell-put_doi-'], & [id^='paper-tanstack-cell-net-'], & [id^='paper-tanstack-cell-spot_flip-']": {
    borderLeft: "1px solid #1F1F1F !important",
  },
  // Row hover: lift the whole tape line so the eye can track across.
  "& tbody tr[data-row='stock']:hover .paper-tanstack-cell": {
    background: "#101418 !important",
  },
  // Newest minute pinned with a blue left accent.
  "& tbody tr.tape-latest .paper-tanstack-cell:first-of-type": {
    boxShadow: `inset 2px 0 0 0 ${TAPE_CALL_DOI}`,
  },
  "& tbody tr.tape-latest .paper-tanstack-cell": {
    background: "#0A0F16 !important",
  },
  // IST column stays put while the numeric block scrolls sideways.
  "& th:first-of-type, & td:first-of-type": {
    position: "sticky",
    left: 0,
    zIndex: 2,
    background: `${TAPE_TERM_BG} !important`,
    boxShadow: "1px 0 0 0 #1F1F1F",
  },
  "& th:first-of-type": { zIndex: 3 },
  // OI-burst minutes get a coloured spine on the IST cell — the same
  // blue/orange language as the tape columns. Declared after the
  // latest-row rule so it wins on the newest minute.
  "& tbody tr.tape-burst-call .paper-tanstack-cell:first-of-type": {
    boxShadow: `inset 3px 0 0 0 ${TAPE_CALL_DOI}`,
  },
  "& tbody tr.tape-burst-put .paper-tanstack-cell:first-of-type": {
    boxShadow: `inset 3px 0 0 0 ${TAPE_PUT_DOI}`,
  },
  // Live tick animations — inset glow fades out (background can't be
  // animated here because cells pin it with !important).
  "@keyframes tapeRowFlash": {
    "0%": { boxShadow: "inset 0 0 0 100px rgba(31, 127, 255, 0.40)" },
    "100%": { boxShadow: "inset 0 0 0 100px rgba(31, 127, 255, 0)" },
  },
  "@keyframes tapeCellFlash": {
    "0%": { boxShadow: "inset 0 0 0 100px rgba(242, 204, 96, 0.45)" },
    "100%": { boxShadow: "inset 0 0 0 100px rgba(242, 204, 96, 0)" },
  },
  "& tbody tr.tape-flash .paper-tanstack-cell": {
    animation: "tapeRowFlash 1.5s ease-out",
  },
  "& .tape-cell-flash": {
    animation: "tapeCellFlash 1.5s ease-out",
  },
};

function NiftyTapeTableInner({
  rows,
  tape,
  live = false,
  bursts,
  updatedAtMs = null,
  nextUpdateAtMs = null,
  gex,
  spot = null,
}: {
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
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  // Live tick feedback: which minute just arrived (row flash) and which
  // existing minutes had values revised (cell flash).
  const [flashT, setFlashT] = useState<string | null>(null);
  const [changed, setChanged] = useState<Map<string, Set<string>>>(new Map());
  const prevRowsRef = useRef<Map<string, NiftyTapeRow>>(new Map());
  const prevLatestRef = useRef<string>("");
  const baseline = useMemo(() => getTapeBaseline(tape, rows), [rows, tape]);
  /** Newest-first (default) or oldest-first; copy, never mutate the prop. */
  const ordered = useMemo(() => {
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    return order === "newest" ? asc.reverse() : asc;
  }, [rows, order]);
  const scale = useMemo(() => computeTapeScale(rows), [rows]);
  const spotDeltas = useMemo(() => computeSpotDeltas(rows), [rows]);
  // The column model embeds the live flash map in its cell closures. Keying
  // the memo on a cheap serialised signature (instead of the Map identity)
  // keeps the whole 12-column model stable across ticks whose flash content
  // is unchanged — a fresh-but-equal Map never rebuilds it.
  const changedKey = useMemo(() => serializeChangedCells(changed), [changed]);
  // Content-keyed identity: a fresh-but-equal Map keeps the previous instance,
  // so the 12-column model is not rebuilt on every tick.
  const stableChanged = useMemo(() => deserializeChangedCells(changedKey), [changedKey]);
  // The tape's own last spot is the fallback for the flip placement — the
  // recorded rows are the only spot the tape knows for sure.
  const tapeSpot = useMemo(() => {
    const asc = [...rows].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    return asc.length > 0 ? asc[asc.length - 1].spot : null;
  }, [rows]);
  // Spot-relative gamma flip: the same level the gamma strip shows. Without
  // the gex block the tape keeps the flip recorded with its rows.
  const flipAtSpot = useMemo(() => {
    if (!gex) return null;
    const reference = Number.isFinite(spot as number) ? (spot as number) : tapeSpot;
    if (reference === null || !Number.isFinite(reference)) return null;
    return gexFlipAtSpot(gex, reference);
  }, [gex, spot, tapeSpot]);
  const columns = useMemo(
    () =>
      getNiftyTapeColumns(
        baseline ?? undefined,
        scale,
        spotDeltas,
        stableChanged,
        flipAtSpot,
      ),
    [baseline, scale, spotDeltas, stableChanged, flipAtSpot],
  );
  const head = useMemo(
    () => buildTapeHead(rows, tape, flipAtSpot),
    [rows, tape, flipAtSpot],
  );
  const doiLabel = useMemo(() => tapeDoiLabel(tape, rows), [rows, tape]);
  const session = useMemo(() => computeTapeSession(rows), [rows]);
  const flipSigned = `${head.flipDeltaPts >= 0 ? "+" : ""}${head.flipDeltaPts.toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts`;
  const latestT =
    ordered.length > 0
      ? order === "newest"
        ? ordered[0].t
        : ordered[ordered.length - 1].t
      : "";

  // Diff each incoming snapshot against the previous one: a new minute →
  // row flash; a revised value on an existing minute → cell flash. Both
  // auto-clear after the animation window so nothing stays lit.
  // Perf: snapshots whose content did not move skip setState AND the 1.6s
  // clear timer entirely, so a quiescent tick costs one effect with no
  // second render. The timer only (re)starts while a flash is actually lit.
  const flashPendingRef = useRef(false);
  useEffect(() => {
    const prevRows = prevRowsRef.current;
    const prevLatest = prevLatestRef.current;
    prevLatestRef.current = latestT;
    const isNewLatest = Boolean(prevLatest && latestT && prevLatest !== latestT);
    if (isNewLatest) {
      setFlashT(latestT);
    }
    // A brand-new minute is never in the previous snapshot, so it can't
    // appear here — the row flash covers it. Only genuine revisions flash.
    const moved = computeChangedCells(prevRows, rows);
    if (moved.size > 0) {
      setChanged(moved);
    }
    const snapshot = new Map<string, NiftyTapeRow>();
    for (const r of rows) snapshot.set(r.t, r);
    prevRowsRef.current = snapshot;
    if (isNewLatest || moved.size > 0) {
      flashPendingRef.current = true;
    }
    if (!flashPendingRef.current) return;
    const id = setTimeout(() => {
      flashPendingRef.current = false;
      // Functional updates that return the previous state when already
      // clear — React bails out, so an idle timer never forces a render.
      setFlashT((prev) => (prev === null ? prev : null));
      setChanged((prev) => (prev.size === 0 ? prev : new Map()));
    }, 1600);
    return () => clearTimeout(id);
  }, [rows, latestT]);

  // Stable row class-name resolver: only identity-changes when its inputs do,
  // so the table is not handed a new function every render.
  const getRowClassName = useCallback(
    (row: NiftyTapeRow) => {
      const cls: string[] = [];
      const side = bursts?.get(row.t);
      if (side === "call") cls.push("tape-burst-call");
      else if (side === "put") cls.push("tape-burst-put");
      if (row.t === flashT) cls.push("tape-flash");
      else if (row.t === latestT) cls.push("tape-latest");
      return cls.length > 0 ? cls.join(" ") : undefined;
    },
    [bursts, flashT, latestT],
  );

  return (
    // Fixed px chrome: root gaps are 4px; the table wrap below owns the only
    // height budget. No `overflow` on this Box — it is not a page-column
    // child, but the rule stands: only inner scroll containers scroll.
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0, background: TAPE_TERM_BG }}>
      {/* Single wrapping stat line (was two stacked rows): PCR OI, ΔOI since
          baseline, max pain, flip, walls, then session meta + order toggle +
          LIVE dot all flow inline so the head is one ~18px line at width. */}
      <Box data-testid="nifty-tape-head" sx={{ background: TAPE_TERM_BG, px: 0.75, pt: 0.25 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            columnGap: 1.5,
            rowGap: 0.25,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Box data-testid="nifty-tape-pcr" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>PCR OI</Text>
            <Text data-testid="nifty-tape-head-pcr-oi" size="sm" span fw={700}>{formatTapeRatio(head.pcrOi)}</Text>
            <Text size="xs" span c="dimmed">snapshot</Text>
          </Box>
          <Box data-testid="nifty-tape-head-pcr-doi" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>{doiLabel}</Text>
            <Text size="sm" span fw={700} c={TAPE_CALL_DOI}>{formatTapeSigned(head.pcrDoiDelta)}</Text>
          </Box>
          <Box data-testid="nifty-tape-max-pain" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Max pain</Text>
            <Text data-testid="nifty-tape-head-max-pain" size="sm" span fw={700}>{formatTapePrice(head.maxPain)}</Text>
          </Box>
          <Box data-testid="nifty-tape-flip" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Flip</Text>
            <Text data-testid="nifty-tape-head-flip" size="sm" span fw={700}>
              {formatTapePrice(head.flip)}{" "}
              <Text size="xs" span c={head.flipDeltaPts >= 0 ? TAPE_FLIP_POS_TEXT : TAPE_FLIP_NEG_TEXT} fw={700}>
                {flipSigned}
              </Text>
            </Text>
            <Text size="xs" span c="dimmed">spot−flip</Text>
          </Box>
          <Box data-testid="nifty-tape-walls" sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" span c="dimmed" tt="uppercase" fw={600}>Walls</Text>
            <Text data-testid="nifty-tape-head-walls" size="sm" span fw={700}>
              {formatTapePrice(head.wallCall)} / {formatTapePrice(head.wallPut)}
            </Text>
            <Text size="xs" span c="dimmed">call / put</Text>
          </Box>
          <Text size="xs" c="dimmed" ta="left" span>
            TICKS {rows.length} · one per minute
          </Text>
          {updatedAtMs !== null && (
            <Text
              data-testid="nifty-tape-updated"
              size="xs"
              c="dimmed"
              span
              sx={{ fontVariantNumeric: "tabular-nums" }}
            >
              upd {formatIstClock(updatedAtMs)}
              {nextUpdateAtMs !== null ? ` · next ${formatIstClock(nextUpdateAtMs)}` : ""}
            </Text>
          )}
          <Text size="xs" c="dimmed" span>
            SPOT {formatTapePrice(session.spotLo)}–{formatTapePrice(session.spotHi)}
          </Text>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" c="dimmed" span>MAX ΔOI</Text>
            <Text size="xs" c={TAPE_CALL_DOI} fw={700} span>C {formatTapeCompact(session.maxCallDoi)}</Text>
            <Text size="xs" c={TAPE_PUT_DOI} fw={700} span>P {formatTapeCompact(session.maxPutDoi)}</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Text size="xs" c="dimmed" span>NET</Text>
            <Text
              size="xs"
              span
              fw={700}
              c={session.netLast >= 0 ? TAPE_NET_TEXT : TAPE_FLIP_NEG_TEXT}
              title="Cumulative put ΔOI − call ΔOI at the last recorded minute (the tape's `net` is already a running total — the column is never summed)"
            >
              {formatTapeCompact(session.netLast)}
            </Text>
          </Box>
          <Box
            data-testid="nifty-tape-order-toggle"
            component="button"
            onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
            sx={{
              border: "1px solid #2A2A2A",
              background: "transparent",
              color: TAPE_CALL_DOI,
              borderRadius: 999,
              px: 1,
              py: 0.25,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
              letterSpacing: 0.3,
            }}
          >
            {order === "newest" ? "NEWEST FIRST ↓" : "OLDEST FIRST ↑"}
          </Box>
          {live && (
            <Box
              data-testid="nifty-tape-live"
              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <Box
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  bgcolor: palette.POSITIVE,
                  "@keyframes tapePulse": {
                    "0%": { opacity: 1, boxShadow: `0 0 0 0 ${hexToRgba(palette.POSITIVE, 0.5)}` },
                    "70%": { opacity: 0.6, boxShadow: `0 0 0 5px ${hexToRgba(palette.POSITIVE, 0)}` },
                    "100%": { opacity: 1, boxShadow: `0 0 0 0 ${hexToRgba(palette.POSITIVE, 0)}` },
                  },
                  animation: "tapePulse 1.8s ease-out infinite",
                }}
              />
              <Text size="xs" span fw={700} c={palette.POSITIVE}>LIVE</Text>
            </Box>
          )}
        </Box>
      </Box>
      <Box
        data-testid="nifty-tape-table-wrap"
        sx={TAPE_TABLE_WRAP_SX}
      >
        <TanStackTable<NiftyTapeRow>
          data={ordered}
          columns={columns}
          dataTestId="nifty-tape-table"
          emptyMessage="No tape rows yet"
          fillContainer
          enableSorting={false}
          rowWindowSize={40}
          getRowTestId={getTapeRowTestId}
          getRowClassName={getRowClassName}
        />
      </Box>
      {/* One dense legend line: tight column gap + no row gap so it stays a
          single wrapped line instead of two airy rows. */}
      <Box
        data-testid="nifty-tape-heat-legend"
        sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: 0, px: 0.75, pb: 0.25, lineHeight: 1.25 }}
      >
        <Text size="xs" c="dimmed" span>HEAT</Text>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_POS_HUE, 0.18), borderRadius: 0.5 }} />
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_POS_HUE, 0.45), borderRadius: 0.5 }} />
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_POS_HUE, 0.7), borderRadius: 0.5 }} />
          <Text size="xs" c="dimmed" span title="Positive value in the signed columns — net put-led, call/put tick volume up, PCR up, spot above the flip">positive</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_NEG_HUE, 0.18), borderRadius: 0.5 }} />
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_NEG_HUE, 0.45), borderRadius: 0.5 }} />
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_NEG_HUE, 0.7), borderRadius: 0.5 }} />
          <Text size="xs" c="dimmed" span title="Negative value in the signed columns — net call-led, call/put tick volume down, PCR down, spot below the flip">negative</Text>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 8, background: hexToRgba(TAPE_NET_HUE, 0.7), borderRadius: 0.5 }} />
          <Text size="xs" c="dimmed" span>net ΔOI (put−call)</Text>
        </Box>
        <Box data-testid="nifty-tape-burst-legend" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Box sx={{ width: 10, height: 8, background: TAPE_CALL_DOI, borderRadius: 0.5 }} />
          <Box sx={{ width: 10, height: 8, background: TAPE_PUT_DOI, borderRadius: 0.5 }} />
          <Text size="xs" c="dimmed" span>burst minute</Text>
        </Box>
        <Text size="xs" c="dimmed" span>· brighter = bigger print</Text>
      </Box>
    </Box>
  );
}

/** Memoised leaf panel — report-payload props keep identity between unrelated parent renders. */
export const NiftyTapeTable = memo(NiftyTapeTableInner);
NiftyTapeTable.displayName = "NiftyTapeTable";
