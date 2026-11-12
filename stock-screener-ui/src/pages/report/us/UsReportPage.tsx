import { createMemo, createSignal, For, Show } from "solid-js";

import { Button, Select, Text, ToolbarRow } from "@/ui";
import { INFO, NEGATIVE, POSITIVE, SCALE_DARK, WARNING } from "@/ui/palette";
import type { UsMode, UsRoot } from "../../../types/usReport";
import { UsChart } from "./UsChart";
import { UsLadder } from "./UsLadder";
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from "./usReportMath";
import { useUsReport } from "./useUsReport";

const ROOTS: { id: UsRoot; enabled: boolean }[] = [
  { id: "NQ", enabled: true },
  { id: "ES", enabled: false },
  { id: "GC", enabled: false },
];

const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "4", label: "4x" },
  { value: "12", label: "12x" },
  { value: "30", label: "30x" },
];

function Stat(props: { label: string; value: string; color?: string; testId?: string }) {
  return (
    <div class="flex items-baseline gap-1 min-w-0" data-testid={props.testId}>
      <Text size="xs" c="dimmed" span className="text-[9px] tracking-[0.3px] whitespace-nowrap">
        {props.label}
      </Text>
      <Text size="xs" span className="font-mono font-bold text-[11px] whitespace-nowrap" style={{ color: props.color }}>
        {props.value}
      </Text>
    </div>
  );
}

export function UsReportPage() {
  const [root, setRoot] = createSignal<UsRoot>("NQ");
  const [mode, setMode] = createSignal<UsMode>("live");
  const [tf, setTf] = createSignal(1);
  const us = useUsReport(root, mode);
  const row = () => us.row();

  const topStrikes = createMemo(() => {
    const r = row();
    if (!r) return [];
    const lo = r.spot * 0.96;
    const hi = r.spot * 1.04;
    return [...r.strikes]
      .filter((s) => s.k >= lo && s.k <= hi)
      .sort((a, b) => b.c_oi + b.p_oi - (a.c_oi + a.p_oi))
      .slice(0, 9);
  });

  const chgColor = () => {
    const r = row();
    return r?.change_pct == null ? undefined : r.change_pct >= 0 ? POSITIVE : NEGATIVE;
  };

  return (
    <div
      data-testid="us-report"
      class="flex flex-col h-full min-h-0 gap-1 p-[6px] overflow-hidden tabular-nums"
    >
      {/* ---- controls ---- */}
      <ToolbarRow gap={6} data-testid="us-toolbar" style={{ "min-height": "26px" }}>
        <Text size="xs" fw={800} span className="tracking-[0.8px] text-[11px]">
          US FUTURES
        </Text>
        <div class="flex gap-0.5">
          <For each={ROOTS}>
            {(r) => (
            <Button
              key={r.id}
              size="xs"
              variant={root() === r.id ? "filled" : "subtle"}
              disabled={!r.enabled}
              title={r.enabled ? r.id : "coming later"}
              onClick={() => r.enabled && setRoot(r.id)}
              data-testid={`us-root-${r.id}`}
              style={{ "min-width": "34px", "height": "22px", "padding-left": "6px", "padding-right": "6px", "font-size": "10px" }}
            >
              {r.id}
            </Button>
            )}
          </For>
        </div>
        <div class="flex gap-0.5">
          <For each={["live", "eod"] as UsMode[]}>
            {(m) => (
            <Button
              key={m}
              size="xs"
              variant={mode() === m ? "filled" : "subtle"}
              onClick={() => setMode(m)}
              data-testid={`us-mode-${m}`}
              style={{ "min-width": "42px", "height": "22px", "padding-left": "6px", "padding-right": "6px", "font-size": "10px", "text-transform": "uppercase" }}
            >
              {m}
            </Button>
            )}
          </For>
        </div>
        <div class="flex gap-0.5">
          <For each={[1, 5, 15]}>
            {(v) => (
            <Button
              key={v}
              size="xs"
              variant={tf() === v ? "filled" : "subtle"}
              onClick={() => setTf(v)}
              data-testid={`us-tf-${v}`}
              style={{ "min-width": "26px", "height": "22px", "padding-left": "4px", "padding-right": "4px", "font-size": "10px" }}
            >
              {v}m
            </Button>
            )}
          </For>
        </div>
        <Show when={mode() === "eod"}>
          <Select
            size="xs"
            w={118}
            value={us.date() || null}
            onChange={(v) => v && us.setDate(v)}
            data={us.dates().map((d) => ({ value: d, label: d }))}
            placeholder="date"
            data-testid="us-date"
          />
        </Show>
        <div class="flex-1" />
        <Text size="xs" span className="font-mono text-[10px]">
          {row() ? `${row()!.contract} · ${row()!.series} · exp ${row()!.expiry}` : "—"}
        </Text>
        <div
          class="w-1.5 h-1.5 rounded-full"
          style={{
            "background-color": us.status()?.market_open ? POSITIVE : SCALE_DARK[3],
            "box-shadow": us.status()?.market_open ? `0 0 6px ${POSITIVE}` : "none",
          }}
          data-testid="us-session-dot"
        />
        <Text size="xs" c="dimmed" span className="text-[9px]">
          {us.status()?.market_open ? "RTH" : "CLOSED"} {fmtTime(us.status()?.now_et)} ET
        </Text>
        <Button size="xs" variant="subtle" onClick={us.refresh} data-testid="us-refresh" style={{ "height": "22px", "font-size": "10px" }}>
          REFRESH
        </Button>
      </ToolbarRow>

      {/* ---- stats strip ---- */}
      <div
        data-testid="us-stats"
        class="flex items-center gap-[10px] flex-wrap px-1 py-[2px] border-t border-b border-fin-border"
      >
        <Stat label="SPOT" value={row() ? fmtNum(row()!.spot) : "—"} color={INFO} testId="us-spot" />
        <Stat label="CHG" value={row() ? fmtPct(row()!.change_pct) : "—"} color={chgColor()} testId="us-change" />
        <Stat label="PCR" value={row() ? fmtNum(row()!.pcr_oi) : "—"} testId="us-pcr" />
        <Stat label="MAX PAIN" value={row() ? fmtInt(row()!.max_pain) : "—"} color={WARNING} testId="us-max-pain" />
        <Stat label="PUT WALL" value={row() ? fmtInt(row()!.put_wall) : "—"} color={NEGATIVE} testId="us-put-wall" />
        <Stat label="CALL WALL" value={row() ? fmtInt(row()!.call_wall) : "—"} color={POSITIVE} testId="us-call-wall" />
        <Stat label="EXP MOVE" value={row()?.exp_move_pct != null ? `±${fmtNum(row()!.exp_move_pct!)}%` : "—"} testId="us-exp-move" />
        <Stat label="GEX" value={row()?.net_gex ? `${row()!.net_gex! >= 0 ? "+" : ""}${fmtNum(row()!.net_gex!, 0)}m` : "–"} />
        <Stat label="VOL" value={fmtCompact(row()?.volume)} testId="us-vol" />
        <Stat label="MIN" value={mode() === "eod" ? `${us.cursor() + 1}/${us.frames().length}` : String(us.status()?.iterations ?? "—")} />
        <Show when={us.error()}>
          <Text size="xs" span className="text-[9px]" style={{ color: NEGATIVE }}>
            {us.error()}
          </Text>
        </Show>
      </div>

      {/* ---- EOD settled strip ---- */}
      <Show when={mode() === "eod" && us.eod()}>
        <div
          data-testid="us-eod"
          class="flex items-center gap-[10px] flex-wrap px-1 py-[1px] border-b border-fin-border"
          style={{ "background-color": "rgba(88,166,255,0.04)" }}
        >
          <Stat label="OPEN" value={fmtInt(us.eod()!.open)} />
          <Stat label="HIGH" value={fmtInt(us.eod()!.high)} color={POSITIVE} />
          <Stat label="LOW" value={fmtInt(us.eod()!.low)} color={NEGATIVE} />
          <Stat label="CLOSE" value={fmtInt(us.eod()!.close)} />
          <Stat label="WALL MIGR" value={String(us.eod()!.wall_migrations)} />
          <Stat label="PAIN HITS" value={String(us.eod()!.max_pain_touches)} color={WARNING} />
          <Stat label="MIN" value={`${us.eod()!.minutes}`} />
          <Stat label="LAST TAPE" value={fmtTime(us.eod()!.last_t)} />
        </div>
      </Show>

      {/* ---- ladder + chart ---- */}
      <div class="flex gap-1 flex-1 min-h-0">
        <div class="w-[400px] min-w-[340px] flex flex-col">
          <Show when={row()}><UsLadder row={row()!} /></Show>
        </div>
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <UsChart frames={us.frames()} cursor={us.cursor()} bucket={tf()} />
          <Show when={mode() === "eod"}>
            <div
              data-testid="us-playback"
              class="flex items-center gap-1 h-[26px] px-1 border border-fin-border"
            >
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(0)}
                disabled={!us.frames().length}
                style={{ "min-width": "24px", "height": "20px", "padding-left": "4px", "padding-right": "4px", "font-size": "10px" }}
                aria-label="Jump to first frame"
              >
                |&lt;
              </Button>
              <Button
                size="xs"
                variant={us.playing() ? "filled" : "subtle"}
                onClick={us.togglePlay}
                disabled={us.frames().length < 2}
                data-testid="us-play"
                style={{ "min-width": "28px", "height": "20px", "padding-left": "4px", "padding-right": "4px", "font-size": "10px" }}
              >
                {us.playing() ? "||" : ">"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(us.frames().length - 1)}
                disabled={!us.frames().length}
                style={{ "min-width": "24px", "height": "20px", "padding-left": "4px", "padding-right": "4px", "font-size": "10px" }}
                aria-label="Jump to last frame"
              >
                &gt;|
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0, us.frames().length - 1)}
                value={Math.min(us.cursor(), Math.max(0, us.frames().length - 1))}
                onInput={(e) => us.setCursor(Number(e.currentTarget.value))}
                data-testid="us-seek"
                class="flex-1 h-3 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:bg-[var(--color-fin-border)] [&::-webkit-slider-runnable-track]:rounded-[1px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:bg-[var(--us-thumb)]"
                style={{ "accent-color": INFO, "--us-thumb": INFO }}
              />
              <div class="w-16">
                <Select
                  size="xs"
                  value={String(us.speed())}
                  onChange={(v) => v && us.setSpeed(Number(v))}
                  data={SPEEDS}
                  data-testid="us-speed"
                />
              </div>
              <Text size="xs" span className="font-mono text-[10px] min-w-[92px] text-right">
                {row() ? `${fmtTime(row()!.t)} · ${fmtInt(row()!.spot)}` : "—"}
              </Text>
            </div>
          </Show>
        </div>
      </div>

      {/* ---- strikes strip ---- */}
      <div
        data-testid="us-strikes"
        class="h-[118px] border border-fin-border flex flex-col font-mono text-[10px] leading-[14px] overflow-hidden"
      >
        <div
          class="grid grid-cols-[70px_70px_70px_70px_70px_70px_1fr] px-1 text-fin-text-muted border-b border-fin-border text-[9px] tracking-[0.4px]"
        >
          <span>STRIKE</span>
          <span style={{ textAlign: "right" }}>CALL OI</span>
          <span style={{ textAlign: "right" }}>CALL VOL</span>
          <span style={{ textAlign: "right" }}>PUT OI</span>
          <span style={{ textAlign: "right" }}>PUT VOL</span>
          <span style={{ textAlign: "right" }}>NET OI</span>
          <span style={{ textAlign: "right" }}>GEX $m</span>
        </div>
        <div class="flex-1 overflow-auto">
          <For each={topStrikes()}>
            {(s) => {
            const net = s.c_oi - s.p_oi;
            return (
              <div
                key={s.k}
                data-testid={`us-strike-${s.k}`}
                class="grid grid-cols-[70px_70px_70px_70px_70px_70px_1fr] px-1"
                style={{ "background-color": s.k === row?.put_wall || s.k === row?.call_wall ? "rgba(255,255,255,0.04)" : "transparent" }}
              >
                <span style={{ "font-weight": s.k === row?.max_pain ? 800 : 500, color: s.k === row?.max_pain ? WARNING : undefined }}>
                  {fmtInt(s.k)}
                </span>
                <span style={{ textAlign: "right", color: POSITIVE }}>{fmtInt(s.c_oi)}</span>
                <span style={{ textAlign: "right", color: "var(--color-fin-text-muted)" }}>{fmtInt(s.c_vol)}</span>
                <span style={{ textAlign: "right", color: NEGATIVE }}>{fmtInt(s.p_oi)}</span>
                <span style={{ textAlign: "right", color: "var(--color-fin-text-muted)" }}>{fmtInt(s.p_vol)}</span>
                <span style={{ textAlign: "right", color: net >= 0 ? POSITIVE : NEGATIVE }}>{net > 0 ? "+" : ""}{fmtInt(net)}</span>
                <span style={{ textAlign: "right", color: s.g ? (s.g >= 0 ? POSITIVE : NEGATIVE) : undefined }}>{s.g ? fmtNum(s.g, 1) : "–"}</span>
              </div>
            );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
