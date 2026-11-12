import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
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

/** `FII` when the flows are today's, `FII·23` when they are a prior session's. */
function sessionTag(label: string, flowDate: string | null, session: string): string {
  if (!flowDate || !session || flowDate === session) return label;
  return `${label}·${flowDate.slice(8, 10)}`;
}

function Sep() {
  return <span aria-hidden className="shrink-0" style={{ color: palette.TEXT_MUTED, opacity: 0.6 }}>&middot;</span>;
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
    <div
      data-testid={testId}
      title={title}
      className="inline-flex items-baseline gap-1 shrink-0 min-w-0"
      style={{ color: palette.TEXT_MUTED }}
    >
      <span className="text-[9px] tracking-[0.04em]">{label}</span>
      <span className="font-bold text-[10.5px] font-mono tabular-nums whitespace-nowrap" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function StrikeRows({ rows, side }: { rows: NiftyIntelStrike[]; side: "call" | "put" }) {
  if (rows.length === 0) {
    return <Text size="xs" c="dimmed" data-testid={`nifty-intel-modal-${side}-empty`}>
      no ΔOI strikes
    </Text>;
  }
  return (
    <div className="flex flex-col gap-[2px]">
      {rows.map((row) => (
        <div
          key={`${side}-${row.strike}`}
          data-testid={`nifty-intel-modal-${side}-${Math.round(row.strike)}`}
          className="flex items-baseline justify-between gap-1 border-b border-fin-border py-[2px] font-mono tabular-nums"
        >
          <span className="text-[11px]">{fmtIntelInt(row.strike)}</span>
          <span className="font-bold text-[11px]" style={{ color: oiTone(row.doi, side, palette) }}>
            {fmtIntelOi(row.doi)}
          </span>
        </div>
      ))}
    </div>
  );
}

function IntelBody({ intel, eod = false }: { intel: NiftyIntel; eod?: boolean }) {
  return (
    <div data-testid="nifty-intel-modal" className="flex flex-col gap-1 min-w-0">
      <div className="flex flex-wrap gap-1.5 items-baseline">
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
      </div>
      <div className="flex flex-wrap gap-1.5 items-baseline">
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
      </div>

      {intel.unavailable.length > 0 && (
        <Text size="xs" data-testid="nifty-intel-modal-unavailable" style={{ color: palette.WARNING }}>
          unavailable: {intel.unavailable.join(", ")}
        </Text>
      )}

      <div
        className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5 min-w-0"
      >
        <div data-testid="nifty-intel-modal-top-calls" className="min-w-0">
          <Text
            size="xs"
            fw={700}
            title="Total change in call OI across the chain, in units (contracts × lot size)"
            style={{ color: palette.NEGATIVE, letterSpacing: "0.06em" }}
          >
            TOP CALL ΔOI {fmtIntelOi(intel.dce_oi)}
          </Text>
          <StrikeRows rows={intel.top_dce} side="call" />
        </div>
        <div data-testid="nifty-intel-modal-top-puts" className="min-w-0">
          <Text
            size="xs"
            fw={700}
            title="Total change in put OI across the chain, in units (contracts × lot size)"
            style={{ color: palette.POSITIVE, letterSpacing: "0.06em" }}
          >
            TOP PUT ΔOI {fmtIntelOi(intel.dpe_oi)}
          </Text>
          <StrikeRows rows={intel.top_dpe} side="put" />
        </div>
      </div>

      <div data-testid="nifty-intel-modal-news" className="min-w-0">
        <Text size="xs" fw={700} style={{ color: palette.TEXT_MUTED, letterSpacing: "0.06em" }}>
          NEWS ({intel.news.length})
        </Text>
        {intel.news.length === 0 ? (
          <Text size="xs" c="dimmed" data-testid="nifty-intel-modal-news-empty">
            no headlines
          </Text>
        ) : (
          <ol className="list-none m-0 p-0 flex flex-col">
            {intel.news.map((item, i) => (
              <li
                key={`${item.link || item.heading}-${i}`}
                data-testid={`nifty-intel-news-item-${i}`}
                className="flex items-baseline gap-1 py-[3px] border-b border-fin-border min-w-0"
              >
                <span
                  className="shrink-0 w-[92px] text-[9px] font-mono tabular-nums"
                  style={{ color: palette.TEXT_MUTED }}
                >
                  {item.published}
                </span>
                {item.link ? (
                  <a
                    data-testid={`nifty-intel-news-link-${i}`}
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-fin-text decoration-none min-w-0 overflow-hidden overflow-ellipsis whitespace-nowrap hover:text-fin-positive hover:underline"
                  >
                    {item.heading}
                  </a>
                ) : (
                  <span className="text-[11px] text-fin-text min-w-0">{item.heading}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {intel.as_of && (
        <Text size="xs" c="dimmed" data-testid="nifty-intel-modal-asof">
          as of {formatIntelAsOf(intel.as_of)}
        </Text>
      )}
    </div>
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
      <div
        data-testid="nifty-intel-strip"
        data-state="unavailable"
        style={{ height: 24, minHeight: 24 }}
        className="flex items-center h-[24px] min-h-[24px] shrink-0 px-2 border border-fin-border rounded-[4px] bg-fin-surface overflow-hidden"
      >
        <Text data-testid="nifty-intel-unavailable" size="xs" c="dimmed" style={{ letterSpacing: "0.04em" }}>
          INTEL unavailable
        </Text>
      </div>
    );
  }

  if (showLoading || !intel) {
    return (
      <div
        data-testid="nifty-intel-strip"
        data-state="loading"
        style={{ height: 24, minHeight: 24 }}
        className="flex items-center h-[24px] min-h-[24px] shrink-0 px-2 border border-fin-border rounded-[4px] bg-fin-surface overflow-hidden"
      >
        <Text data-testid="nifty-intel-loading" size="xs" c="dimmed">
          INTEL loading…
        </Text>
      </div>
    );
  }

  const data = intel || EMPTY_INTEL;

  return (
    <>
      <div
        data-testid="nifty-intel-strip"
        role="button"
        tabIndex={0}
        aria-label="Open Nifty intel — FII/DII, ΔOI, max pain, PCR and news"
        data-state={status}
        style={{ height: 24, minHeight: 24 }}
        title={`Session ${data.date || INTEL_DASH} · expiry ${data.expiry || INTEL_DASH}${
          eod ? " · latest session, not this frame" : ""
        }`}
        onClick={openModal}
        onKeyDown={onKeyDown}
        className="flex items-center gap-1.5 h-[24px] min-h-[24px] shrink-0 px-2 border border-fin-border rounded-[4px] bg-fin-surface cursor-pointer overflow-hidden whitespace-nowrap font-mono hover:border-fin-text-muted focus-visible:outline-1 focus-visible:outline-fin-positive focus-visible:outline-offset-0"
      >
        <span className="font-bold shrink-0 text-[9px] tracking-[0.08em]" style={{ color: palette.TEXT_MUTED }}>
          INTEL
        </span>
        <Field
          testId="nifty-intel-fii"
          label={sessionTag("FII", data.fii_date, data.date)}
          value={fmtIntelSigned(data.fii_net)}
          tone={flowTone(data.fii_net, palette)}
          title={`FII cash-market net flow (₹ crore) — session ${data.fii_date ?? "unknown"}${data.fii_date && data.date && data.fii_date !== data.date ? " (previous session; published after its close)" : ""}`}
        />
        <Sep />
        <Field
          testId="nifty-intel-dii"
          label={sessionTag("DII", data.dii_date, data.date)}
          value={fmtIntelSigned(data.dii_net)}
          tone={flowTone(data.dii_net, palette)}
          title={`DII cash-market net flow (₹ crore) — session ${data.dii_date ?? "unknown"}${data.dii_date && data.date && data.dii_date !== data.date ? " (previous session; published after its close)" : ""}`}
        />
        <Sep />
        <div
          data-testid="nifty-intel-doi"
          title="Official change in OI — call / put units (contracts × lot size)"
          className="flex items-baseline gap-1 shrink-0"
        >
          <span className="text-[9px] tracking-[0.04em]" style={{ color: palette.TEXT_MUTED }}>
            ΔOI (official) C
          </span>
          <span className="font-bold text-[10.5px] font-mono tabular-nums" style={{ color: oiTone(data.dce_oi, "call", palette) }}>
            {fmtIntelOi(data.dce_oi)}
          </span>
          <span className="text-[9px]" style={{ color: palette.TEXT_MUTED, opacity: 0.8 }}>
            / P
          </span>
          <span className="font-bold text-[10.5px] font-mono tabular-nums" style={{ color: oiTone(data.dpe_oi, "put", palette) }}>
            {fmtIntelOi(data.dpe_oi)}
          </span>
        </div>
        <Sep />
        <Field testId="nifty-intel-mp" label="MP" value={fmtIntelInt(data.max_pain)} tone={palette.TEXT} title="Max pain strike" />
        <Sep />
        <Field testId="nifty-intel-pcr" label="PCR" value={fmtIntelPcr(data.pcr)} tone={palette.TEXT} title="Official put/call ratio" />
        <Sep />
        <div
          data-testid="nifty-intel-news"
          title={data.news.length ? data.news.map((n) => n.heading).join("\n") : "No headlines"}
          className="text-[10px] font-mono tabular-nums shrink-0"
          style={{ color: palette.TEXT_MUTED }}
        >
          {data.news.length ? `${data.news.length} news` : "no news"}
        </div>
        <span aria-hidden className="ml-auto shrink-0 text-[10px]" style={{ color: palette.TEXT_MUTED }}>
          ▸
        </span>
      </div>

      <PanelModal open={open} title="Nifty intel — FII/DII · ΔOI · news" onClose={() => setOpen(false)}>
        <IntelBody intel={data} eod={eod} />
      </PanelModal>
    </>
  );
}
