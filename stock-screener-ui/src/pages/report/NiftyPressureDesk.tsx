import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { LocalPanelModal } from "./LocalPanelModal";
import type { WallsPayload } from "@/api/reportNifty";
import { BORDER } from "./NiftyPressureDesk.format";
import { PanelTitle, PressureDeskHeader } from "./NiftyPressureDesk.legend";
import { FlowPlane } from "./NiftyPressureDesk.flow";
import { WallList } from "./NiftyPressureDesk.ladder";
import { WallRead } from "./NiftyPressureDesk.details";
import { PressureTable } from "./NiftyPressureDesk.table";
import { combineWalls, nearestWall } from "./pressureDesk";

interface NiftyPressureDeskProps {
  open: boolean;
  onClose: () => void;
  walls: WallsPayload | null;
}

export function NiftyPressureDesk(props: NiftyPressureDeskProps) {
  const allWalls = createMemo(() => (props.walls ? combineWalls(props.walls) : []));
  const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
  const selected = () =>
    allWalls().find((wall) => wall.key === selectedKey()) ?? allWalls()[0] ?? null;

  createEffect(() => {
    if (!props.open || !props.walls) return;
    const wallsList = allWalls();
    const keys = new Set(wallsList.map((wall) => wall.key));
    setSelectedKey((prev) => {
      if (prev && keys.has(prev)) return prev;
      return nearestWall(wallsList, props.walls!.spot)?.key ?? wallsList[0]?.key ?? null;
    });
  });

  return (
    <LocalPanelModal open={props.open} onClose={props.onClose} maxWidth={1480} title={<PressureDeskHeader walls={props.walls} />}>
      <div data-testid="pressure-desk" data-report-spacing="8" class="p-2 min-h-0">
        <Show
          when={props.walls && allWalls().length > 0 ? selected() : null}
          fallback={
            <div data-testid="pressure-desk-empty" class="py-10 text-center text-fin-text-muted font-mono text-ui-micro">
              No walls tape at this replay time.
            </div>
          }
        >
          {(sel) => (
            <>
            {/* Responsive grid with breakpoint-based column widths (md = 900px). */}
            <div
              class="grid grid-cols-1 min-[900px]:grid-cols-[minmax(330px,1.05fr)_minmax(290px,0.9fr)_minmax(320px,1fr)] min-[900px]:gap-x-3 gap-y-3 items-stretch min-h-0"
            >
              <div class="min-w-0 flex">
                <FlowPlane payload={props.walls!} selectedKey={sel().key} onSelect={setSelectedKey} />
              </div>
              {/* Left padding + left border only apply at the md breakpoint */}
              <div
                class="min-w-0 min-[900px]:pl-3 min-[900px]:border-l min-[900px]:border-fin-border"
              >
                <WallRead wall={sel()} payload={props.walls!} />
              </div>
              <div
                class="min-w-0 min-[900px]:pl-3 min-[900px]:border-l min-[900px]:border-fin-border"
              >
                <WallList walls={allWalls()} selectedKey={sel().key} spot={props.walls!.spot} onSelect={setSelectedKey} />
              </div>
            </div>
            <div class="mt-2 pt-[6px] border-t border-fin-border min-w-0" style={{ "border-top": `1px solid ${BORDER}`, "min-width": "0" }}>
              <div class="flex items-baseline justify-between gap-2 flex-wrap">
                <PanelTitle>Current minute · full values</PanelTitle>
                <div class="font-mono text-ui-micro text-fin-text-muted">% vs 5 / 15 / 30m</div>
              </div>
              <PressureTable walls={allWalls()} selectedKey={sel().key} onSelect={setSelectedKey} />
            </div>
            </>
          )}
        </Show>
      </div>
    </LocalPanelModal>
  );
}
