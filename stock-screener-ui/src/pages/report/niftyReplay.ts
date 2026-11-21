import type { NiftyReplayMeta } from "@/api/reportNifty";
import type { NiftyReplay, NiftyReport } from "@/types/niftyReport";

/** Placeholder for a meta-only frame; the full snapshot is fetched on demand. */
export const REPLAY_STUB_REPORT = Object.freeze({}) as unknown as NiftyReport;

/** Build a playable replay skeleton from the cheap meta payload. */
export function replayFromMeta(meta: NiftyReplayMeta): NiftyReplay {
  return {
    date: meta.date,
    count: meta.frames.length,
    interval_sec: meta.interval_sec,
    gap_reasons: meta.gap_reasons,
    snapshots: meta.frames.map((frame) => ({
      t: frame.t,
      fetched_at: "",
      report: REPLAY_STUB_REPORT,
      sensex: null,
    })),
  };
}
