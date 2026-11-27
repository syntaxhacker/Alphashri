import { render } from "solid-js/web";
import { Tooltip } from "@/ui/overlay/Tooltip";
import "../../../src/tailwind.css";

/**
 * Mounts the Tooltip by itself, with no app chrome, so its placement can be
 * measured against the real viewport. The toolbar sits at y=0 exactly like the
 * market toolbar under the tab strip.
 */
const LONG = "Snapshot is older than 15 minutes (as of 2026-11-13T09:15:00+05:30)";

render(
  () => (
    <div>
      <div
        style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          height: "40px",
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "0 12px",
          background: "#13161C",
          "z-index": "10",
          // The market toolbar's real ancestor chain: an overflow-hidden bar.
          // An in-flow absolute tooltip is clipped here; the portal must escape.
          overflow: "hidden",
        }}
      >
        <Tooltip label={LONG} data-testid="default-top-tip">
          <button data-testid="edge-trigger" type="button">
            default top at edge
          </button>
        </Tooltip>
        <Tooltip label={LONG} multiline position="bottom" data-testid="explicit-bottom-tip">
          <button data-testid="bottom-trigger" type="button">
            explicit bottom
          </button>
        </Tooltip>
      </div>

      {/* The section below the toolbar must never cover the floating tooltip. */}
      <div
        style={{
          position: "fixed",
          top: "40px",
          left: "0",
          right: "0",
          height: "220px",
          background: "#0b0d11",
          "z-index": "20",
        }}
      />

      <div style={{ position: "fixed", top: "320px", left: "48px" }}>        <Tooltip label="Mid viewport tooltip" data-testid="mid-tip">
          <button data-testid="mid-trigger" type="button">
            mid
          </button>
        </Tooltip>
      </div>

      <div style={{ position: "fixed", bottom: "8px", left: "48px" }}>
        <Tooltip label="Bottom edge tooltip" data-testid="floor-tip">
          <button data-testid="floor-trigger" type="button">
            near the floor
          </button>
        </Tooltip>
      </div>
    </div>
  ),
  document.getElementById("root")!,
);
