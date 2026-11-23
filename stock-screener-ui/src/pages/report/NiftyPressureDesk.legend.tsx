import { Show } from "solid-js";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import {
  BORDER,
  panelTitleStyles,
  sideColor,
  statusColor,
} from "./NiftyPressureDesk.format";
import type { PressureSide } from "./pressureDesk";
import { REPORT_RADIUS } from "./reportTokens";

export function PanelTitle(props: { children: string }) {
  return (
    <div data-report-text="title" class="mb-2" style={{ ...panelTitleStyles() }}>
      {props.children}
    </div>
  );
}

export function SideMark(props: { side: PressureSide; size?: number }) {
  return (
    <span
      class="inline-block shrink-0"
      style={{
        width: `${props.size ?? 7}px`,
        height: `${props.size ?? 7}px`,
        "flex-shrink": "0",
        "border-radius": props.side === "CALL" ? "50%" : "1px",
        "background-color": sideColor(props.side),
      }}
    />
  );
}

export function FuelBar(props: { score: number | undefined; width?: number }) {
  const value = () => Math.max(0, Math.min(100, props.score ?? 0));
  const width = () => props.width ?? 54;
  return (
    <div
      class="relative shrink-0"
      style={{ width: `${width()}px`, height: "4px" }}
    >
      <div
        class="absolute inset-0 rounded-[1px]"
        style={{ "border-radius": "1px", "background-color": BORDER }}
      />
      <div
        class="absolute left-0 top-0 bottom-0 rounded-[1px]"
        style={{ width: `${value()}%`, "border-radius": "1px", "background-color": palette.TEXT }}
      />
      <div
        class="absolute left-[60%] top-[-2px] bottom-[-2px] w-[1px]"
        style={{ "border-radius": "1px", "background-color": palette.WARNING }}
      />
    </div>
  );
}

export function StatusPill(props: { status: string | null | undefined }) {
  const tone = statusColor(props.status);
  return (
    <span
      class="inline-flex items-center gap-1 rounded-sm px-1 py-[2px] font-mono text-ui-micro font-black tracking-[0.08em] leading-tight whitespace-nowrap"
      style={{
        border: `1px solid ${tone}`,
        "border-radius": `${REPORT_RADIUS.sm}px`,
        color: tone,
      }}
    >
      {props.status ?? "—"}
    </span>
  );
}

export function SummaryChip(props: { label: string; value: string }) {
  return (
    <span
      class="inline-flex items-baseline gap-2 rounded-sm border px-2 py-[2px] text-ui-micro font-mono whitespace-nowrap"
      style={{
        height: "20px",
        "border-color": BORDER,
        color: palette.TEXT,
        border: `1px solid ${BORDER}`,
      }}
    >
      <Show when={props.label}>
        <span data-report-text="label" class="text-fin-text-muted">{props.label}</span>
      </Show>
      <span data-report-text="value" class="text-ui-body">{props.value}</span>
    </span>
  );
}

export function PressureDeskHeader(props: { walls: WallsPayload | null }) {
  return (
    <div class="flex items-center gap-2 min-w-0">
      <div
        data-report-text="title"
        class="font-mono text-ui-title font-black tracking-[0.08em] text-fin-text whitespace-nowrap"
      >
        PRESSURE DESK
      </div>
      <Show when={props.walls}>
        {(walls) => (
          <>
            <SummaryChip label="" value={walls().symbol} />
            <SummaryChip label="" value={`${walls().date} · ${walls().dte == null ? "—" : `${walls().dte}-DTE`}`} />
            <SummaryChip
              label="spot"
              value={
                Number.isFinite(walls().spot)
                  ? walls().spot.toLocaleString("en-IN", { maximumFractionDigits: 2 })
                  : "—"
              }
            />
            <Show when={walls().expiry}>
              {(expiry) => <SummaryChip label="exp" value={expiry()!} />}
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
