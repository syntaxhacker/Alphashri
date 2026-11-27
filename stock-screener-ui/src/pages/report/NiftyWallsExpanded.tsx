import { createEffect, createSignal } from "solid-js";
import { Divider } from "@/ui";
import * as palette from "@/ui/palette";
import type { WallsPayload } from "@/api/reportNifty";
import { LocalPanelModal } from "./LocalPanelModal";
import { WallsMapChart } from "./WallsMap";
import {
  WallsDisclaimer,
  WallsModalHeader,
  WallsViewToggle,
  type WallsView,
} from "./NiftyWallsExpanded.header";
import { WallsStatStrip } from "./NiftyWallsExpanded.statStrip";
import { WallsLadder, WallsHistoryChart } from "./NiftyWallsExpanded.sequences";
import { WallsSequenceTable, WallsTable } from "./NiftyWallsExpanded.eventTable";
import { WallsReadout } from "./NiftyWallsExpanded.readout";
import { REPORT_PAD } from "./reportTokens";

/**
 * Expanded walls facade: owns the modal shell and the MAP/DATA view state,
 * then composes the header, stat strip, tables, sequence and readout modules.
 * All data-testids, tokens and units stay in those modules so the modal can
 * change shape without moving a number out of its cell.
 */
export function NiftyWallsExpanded(props: {
  open: boolean;
  walls: WallsPayload | null;
  onClose: () => void;
  onReplayBreak?: (at: string) => void;
}) {
  const open = () => props.open;
  const walls = () => props.walls;
  const events = () => walls()?.events ?? [];
  const [view, setView] = createSignal<WallsView>(walls()?.wall_map ? "MAP" : "DATA");
  let userChoseView = false;
  const activeView = () => (walls()?.wall_map ? view() : "DATA");

  createEffect(() => {
    if (walls()?.wall_map && !userChoseView) setView("MAP");
  });

  const chooseView = (mode: WallsView) => {
    userChoseView = true;
    setView(mode);
  };

  return (
    <LocalPanelModal
      open={open()}
      onClose={() => props.onClose()}
      maxWidth={1240}
      autoHeight
      max-height="92vh"
      title={<WallsModalHeader walls={walls()!} />}
    >
      <div class="flex flex-col gap-[8px]" style={{ padding: `${REPORT_PAD.sm}px`, display: "flex", "flex-direction": "column", gap: `${REPORT_PAD.sm}px` }}>
        <WallsStatStrip walls={walls()!} />

        <WallsViewToggle
          active={activeView()}
          hasMap={!!walls()!.wall_map}
          onChoose={chooseView}
        />

        {activeView() === "MAP" && walls()!.wall_map ? (
          <WallsMapChart
            map={walls()!.wall_map!}
            events={events()}
            callWall={walls()!.call_wall.strike}
            putWall={walls()!.put_wall.strike}
            maxPain={walls()!.max_pain}
            regime={walls()!.regime}
          />
        ) : (
          <>
            <WallsLadder walls={walls()!} />

            <div class="grid grid-cols-1 md:grid-cols-2" style={{ gap: `${REPORT_PAD.md}px` }}>
              <WallsTable title="CALL WALLS" side="CALL" rows={walls()!.calls} spot={walls()!.spot} />
              <WallsTable title="PUT WALLS" side="PUT" rows={walls()!.puts} spot={walls()!.spot} />
            </div>

            <WallsHistoryChart walls={walls()!} />
          </>
        )}

        <Divider style={{ "border-color": palette.BORDER }} />

        <WallsSequenceTable events={events()} />

        <Divider style={{ "border-color": palette.BORDER }} />

        <WallsReadout walls={walls()!} onReplayBreak={props.onReplayBreak} />

        <WallsDisclaimer />
      </div>
    </LocalPanelModal>
  );
}
