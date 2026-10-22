import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { PanelModal } from "@/components/common/PanelModal";
import {
  EMPTY_INTEL,
  INTEL_DASH,
  NIFTY_INTEL_POLL_MS,
  fetchNiftyIntel,
  flowTone,
  fmtIntelInt,
  fmtIntelOi,
  fmtIntelPcr,
  fmtIntelSigned,
  formatIntelAsOf,
  oiTone,
} from "./niftyIntel";
import type { NiftyIntel, NiftyIntelStrike } from "./niftyIntel";

interface NiftyIntelStripProps {
  /** Poll interval; defaults to 5 minutes. */
  pollMs?: number;
  /** Injectable loader (tests / Storybook); defaults to the real endpoint. */
  fetcher?: (signal?: AbortSignal) => Promise<NiftyIntel>;
  /**
   * Session date / expiry to request. Omitted → the backend defaults to
   * today IST + current-week expiry. Wire these from the report frame so a
   * replay reads its own session instead of the latest one.
   */
  date?: string | null;
  expiry?: string | null;
  /**
   * End-of-day / replay frame: label the block as the *latest session*, not
   * the frame on screen. Without this the strip silently mixes an old report
   * with today's FII/DII and ΔOI.
   */
  eod?: boolean;
}

type Status = "loading" | "ready" | "error";

const STRIP_HEIGHT = 24;

function Sep() {
  return (
    <Box component="span" aria-hidden sx={{ color: palette.TEXT_MUTED, opacity: 0.6, flexShrink: 0 }}>
      ·
    </Box>
  );
}

function Field({
  testId,
  label,
  value,
  tone,
  title,
}: {
  testId: string;
  label: string;
  value: string;
  tone: string;
  title?: string;
}) {
  return (
    <Box
      data-testid={testId}
      title={title}
      sx={{ display: "inline-flex", alignItems: "baseline", gap: "4px", flexShrink: 0, minWidth: 0 }}
    >
      <Box component="span" sx={{ color: palette.TEXT_MUTED, fontSize: 9, letterSpacing: "0.04em" }}>
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          color: tone,
          fontSize: 10.5,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function StrikeRows({ rows, side }: { rows: NiftyIntelStrike[]; side: "call" | "put" }) {
  if (rows.length === 0) {
    return (
      <Text size="xs" c="dimmed" data-testid={`nifty-intel-modal-${side}-empty`}>
        no ΔOI strikes
      </Text>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      {rows.map((row) => (
        <Box
          key={`${side}-${row.strike}`}
          data-testid={`nifty-intel-modal-${side}-${Math.round(row.strike)}`}
          sx={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 1,
            borderBottom: `1px solid ${palette.TERM_BORDER}`,
            py: "2px",
            fontFamily: palette.MONO,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Box component="span" sx={{ fontSize: 11, color: palette.TEXT }}>
            {fmtIntelInt(row.strike)}
          </Box>
          <Box
            component="span"
            sx={{ fontSize: 11, fontWeight: 700, color: oiTone(row.doi, side, palette) }}
          >
            {fmtIntelOi(row.doi)}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function IntelBody({ intel, eod = false }: { intel: NiftyIntel; eod?: boolean }) {
  return (
    <Box data-testid="nifty-intel-modal" sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "baseline" }}>
        <Field
          testId="nifty-intel-modal-date"
          label="Session"
          value={intel.date || INTEL_DASH}
          tone={palette.TEXT}
          title="Upstox session date this intel block describes"
        />
        <Field
          testId="nifty-intel-modal-expiry"
          label="Expiry"
          value={intel.expiry || INTEL_DASH}
          tone={palette.TEXT}
          title="Option expiry the ΔOI / max-pain / PCR series are measured on"
        />
        {eod && (
          <Text size="xs" data-testid="nifty-intel-modal-eod" style={{ color: palette.WARNING }}>
            latest session — not this replay frame
          </Text>
        )}
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "baseline" }}>
        <Field
          testId="nifty-intel-modal-fii"
          label="FII net"
          value={fmtIntelSigned(intel.fii_net)}
          tone={flowTone(intel.fii_net, palette)}
          title="FII cash-market net flow (₹ crore), official Upstox series"
        />
        <Field
          testId="nifty-intel-modal-dii"
          label="DII net"
          value={fmtIntelSigned(intel.dii_net)}
          tone={flowTone(intel.dii_net, palette)}
          title="DII cash-market net flow (₹ crore), official Upstox series"
        />
        <Field
          testId="nifty-intel-modal-pcr"
          label="PCR"
          value={fmtIntelPcr(intel.pcr)}
          tone={palette.TEXT}
          title="Official Upstox put/call ratio"
        />
        <Field
          testId="nifty-intel-modal-mp"
          label="Max pain"
          value={fmtIntelInt(intel.max_pain)}
          tone={palette.TEXT}
          title="Official Upstox max-pain strike"
        />
      </Box>

      {intel.unavailable.length > 0 && (
        <Text size="xs" data-testid="nifty-intel-modal-unavailable" style={{ color: palette.WARNING }}>
          unavailable: {intel.unavailable.join(", ")}
        </Text>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" },
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Box data-testid="nifty-intel-modal-top-calls" sx={{ minWidth: 0 }}>
          <Text
            size="xs"
            fw={700}
            title="Total change in call OI across the chain, in units (contracts × lot size)"
            style={{ color: palette.NEGATIVE, letterSpacing: "0.06em" }}
          >
            TOP CALL ΔOI {fmtIntelOi(intel.dce_oi)}
          </Text>
          <StrikeRows rows={intel.top_dce} side="call" />
        </Box>
        <Box data-testid="nifty-intel-modal-top-puts" sx={{ minWidth: 0 }}>
          <Text
            size="xs"
            fw={700}
            title="Total change in put OI across the chain, in units (contracts × lot size)"
            style={{ color: palette.POSITIVE, letterSpacing: "0.06em" }}
          >
            TOP PUT ΔOI {fmtIntelOi(intel.dpe_oi)}
          </Text>
          <StrikeRows rows={intel.top_dpe} side="put" />
        </Box>
      </Box>

      <Box data-testid="nifty-intel-modal-news" sx={{ minWidth: 0 }}>
        <Text size="xs" fw={700} style={{ color: palette.TEXT_MUTED, letterSpacing: "0.06em" }}>
          NEWS ({intel.news.length})
        </Text>
        {intel.news.length === 0 ? (
          <Text size="xs" c="dimmed" data-testid="nifty-intel-modal-news-empty">
            no headlines
          </Text>
        ) : (
          <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column" }}>
            {intel.news.map((item, i) => (
              <Box
                component="li"
                key={`${item.link || item.heading}-${i}`}
                data-testid={`nifty-intel-news-item-${i}`}
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 1,
                  py: "3px",
                  borderBottom: `1px solid ${palette.TERM_BORDER}`,
                  minWidth: 0,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    flexShrink: 0,
                    width: 92,
                    color: palette.TEXT_MUTED,
                    fontFamily: palette.MONO,
                    fontSize: 9,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.published}
                </Box>
                {item.link ? (
                  <Box
                    component="a"
                    data-testid={`nifty-intel-news-link-${i}`}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      color: palette.TEXT,
                      fontSize: 11,
                      textDecoration: "none",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      "&:hover": { color: palette.POSITIVE, textDecoration: "underline" },
                    }}
                  >
                    {item.heading}
                  </Box>
                ) : (
                  <Box component="span" sx={{ color: palette.TEXT, fontSize: 11, minWidth: 0 }}>
                    {item.heading}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {intel.as_of && (
        <Text size="xs" c="dimmed" data-testid="nifty-intel-modal-asof">
          as of {formatIntelAsOf(intel.as_of)}
        </Text>
      )}
    </Box>
  );
}

/**
 * 24px desk strip: FII/DII net flows, official ΔOI totals, max pain, PCR and
 * the headline count. Click (or Enter/Space) opens the ΔOI + news drawer in
 * the shared `PanelModal`. Fetches on mount and every 5 minutes; failures keep
 * the last good data and only the first failure shows `INTEL unavailable`.
 */
export function NiftyIntelStrip({
  pollMs = NIFTY_INTEL_POLL_MS,
  fetcher,
  date = null,
  expiry = null,
  eod = false,
}: NiftyIntelStripProps) {
  const [intel, setIntel] = useState<NiftyIntel | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [open, setOpen] = useState(false);
  // Default loader carries the frame's session/expiry; an injected fetcher
  // (tests/Storybook) owns its own request.
  const effectiveFetcher = useMemo(
    () =>
      fetcher ??
      ((signal?: AbortSignal) => fetchNiftyIntel(signal, { date, expiry })),
    [fetcher, date, expiry],
  );
  const fetcherRef = useRef(effectiveFetcher);
  useEffect(() => {
    fetcherRef.current = effectiveFetcher;
  }, [effectiveFetcher]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = async () => {
      try {
        const data = await fetcherRef.current(controller.signal);
        if (!alive) return;
        setIntel(data);
        setStatus("ready");
      } catch {
        if (!alive || controller.signal.aborted) return;
        setStatus("error");
      }
    };

    void load();
    timer = setInterval(() => void load(), pollMs);
    return () => {
      alive = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [pollMs, date, expiry]);

  const openModal = useCallback(() => {
    if (intel) setOpen(true);
  }, [intel]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openModal();
      }
    },
    [openModal],
  );

  const showEmpty = !intel && status === "error";
  const showLoading = !intel && status !== "error";

  if (showEmpty) {
    return (
      <Box
        data-testid="nifty-intel-strip"
        data-state="unavailable"
        sx={{
          display: "flex",
          alignItems: "center",
          height: STRIP_HEIGHT,
          minHeight: STRIP_HEIGHT,
          flexShrink: 0,
          px: 1,
          border: `1px solid ${palette.TERM_BORDER}`,
          borderRadius: "4px",
          bgcolor: palette.TERM_HEADER,
          overflow: "hidden",
        }}
      >
        <Text data-testid="nifty-intel-unavailable" size="xs" c="dimmed" style={{ letterSpacing: "0.04em" }}>
          INTEL unavailable
        </Text>
      </Box>
    );
  }

  if (showLoading || !intel) {
    return (
      <Box
        data-testid="nifty-intel-strip"
        data-state="loading"
        sx={{
          display: "flex",
          alignItems: "center",
          height: STRIP_HEIGHT,
          minHeight: STRIP_HEIGHT,
          flexShrink: 0,
          px: 1,
          border: `1px solid ${palette.TERM_BORDER}`,
          borderRadius: "4px",
          bgcolor: palette.TERM_HEADER,
          overflow: "hidden",
        }}
      >
        <Text data-testid="nifty-intel-loading" size="xs" c="dimmed">
          INTEL loading…
        </Text>
      </Box>
    );
  }

  const data = intel || EMPTY_INTEL;

  return (
    <>
      <Box
        data-testid="nifty-intel-strip"
        role="button"
        tabIndex={0}
        aria-label="Open Nifty intel — FII/DII, ΔOI, max pain, PCR and news"
        data-state={status}
        title={`Session ${data.date || INTEL_DASH} · expiry ${data.expiry || INTEL_DASH}${
          eod ? " · latest session, not this frame" : ""
        }`}
        onClick={openModal}
        onKeyDown={onKeyDown}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: STRIP_HEIGHT,
          minHeight: STRIP_HEIGHT,
          flexShrink: 0,
          px: 1,
          border: `1px solid ${palette.TERM_BORDER}`,
          borderRadius: "4px",
          bgcolor: palette.TERM_HEADER,
          cursor: "pointer",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontFamily: palette.MONO,
          "&:hover": { borderColor: palette.TEXT_MUTED },
          "&:focus-visible": { outline: `1px solid ${palette.POSITIVE}`, outlineOffset: 0 },
        }}
      >
        <Box
          component="span"
          sx={{ color: palette.TEXT_MUTED, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", flexShrink: 0 }}
        >
          INTEL
        </Box>
        <Field
          testId="nifty-intel-fii"
          label="FII"
          value={fmtIntelSigned(data.fii_net)}
          tone={flowTone(data.fii_net, palette)}
          title="FII cash-market net flow (₹ crore)"
        />
        <Sep />
        <Field
          testId="nifty-intel-dii"
          label="DII"
          value={fmtIntelSigned(data.dii_net)}
          tone={flowTone(data.dii_net, palette)}
          title="DII cash-market net flow (₹ crore)"
        />
        <Sep />
        <Box
          data-testid="nifty-intel-doi"
          title="Official change in OI — call / put units (contracts × lot size)"
          sx={{ display: "inline-flex", alignItems: "baseline", gap: "4px", flexShrink: 0 }}
        >
          <Box component="span" sx={{ color: palette.TEXT_MUTED, fontSize: 9, letterSpacing: "0.04em" }}>
            ΔOI C
          </Box>
          <Box
            component="span"
            sx={{ color: oiTone(data.dce_oi, "call", palette), fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          >
            {fmtIntelOi(data.dce_oi)}
          </Box>
          <Box component="span" sx={{ color: palette.TEXT_MUTED, fontSize: 9, opacity: 0.8 }}>
            / P
          </Box>
          <Box
            component="span"
            sx={{ color: oiTone(data.dpe_oi, "put", palette), fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          >
            {fmtIntelOi(data.dpe_oi)}
          </Box>
        </Box>
        <Sep />
        <Field
          testId="nifty-intel-mp"
          label="MP"
          value={fmtIntelInt(data.max_pain)}
          tone={palette.TEXT}
          title="Max pain strike"
        />
        <Sep />
        <Field
          testId="nifty-intel-pcr"
          label="PCR"
          value={fmtIntelPcr(data.pcr)}
          tone={palette.TEXT}
          title="Official put/call ratio"
        />
        <Sep />
        <Box
          data-testid="nifty-intel-news"
          title={data.news.length ? data.news.map((n) => n.heading).join("\n") : "No headlines"}
          sx={{ color: palette.TEXT_MUTED, fontSize: 10, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
        >
          {data.news.length ? `${data.news.length} news` : "no news"}
        </Box>
        <Box component="span" aria-hidden sx={{ marginLeft: "auto", color: palette.TEXT_MUTED, fontSize: 10, flexShrink: 0 }}>
          ▸
        </Box>
      </Box>

      <PanelModal open={open} title="Nifty intel — FII/DII · ΔOI · news" onClose={() => setOpen(false)}>
        <IntelBody intel={data} eod={eod} />
      </PanelModal>
    </>
  );
}
