import type { ReplayCandle } from "./replay";

export type NiftyReportMode = "live" | "eod";

export interface NiftyOptionSide {
  ltp: number;
  close: number;
  oi: number;
  prevOi: number;
  oiChange: number;
  priceChange: number;
  sentiment: string;
}

export interface NiftyStrike {
  strike: number;
  ce: NiftyOptionSide;
  pe: NiftyOptionSide;
}

export interface NiftyWall {
  strike: number;
  oi: number;
}

export interface NiftyOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface NiftyTimelineEvent {
  time: string;
  title: string;
  detail: string;
}

export interface NiftyReport {
  mode: NiftyReportMode;
  date: string;
  expiry: string;
  spot: number;
  ohlc: NiftyOhlc;
  pcrOi: number;
  pcrVol: number;
  maxPain: number;
  walls: {
    calls: NiftyWall[];
    puts: NiftyWall[];
  };
  strikes: NiftyStrike[];
  timeline: NiftyTimelineEvent[];
  candles?: ReplayCandle[];
  fetchedAt?: string;
  snapshotAt?: string;
}
