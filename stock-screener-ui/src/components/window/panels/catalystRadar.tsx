import type { Accessor } from "solid-js";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";
import { CatalystRadarPanel } from "../../catalyst/CatalystRadarPanel";

/** The catalyst list is market-wide, so the dock context is deliberately unused. */
function CatalystRadarWindow() {
  return <CatalystRadarPanel />;
}

export const CATALYST_RADAR_PANEL: DockPanelSpec = {
  id: "catalyst.radar",
  page: "report",
  title: "CATALYST RADAR",
  size: 1,
  minWidth: 320,
  singleton: true,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <CatalystRadarWindow />,
};
