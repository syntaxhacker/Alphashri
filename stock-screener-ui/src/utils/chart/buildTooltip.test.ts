import { describe, expect, it } from "vitest";
import { buildTooltip } from "./buildTooltip";
import { buildHolidayMap } from "../chartUtils";
import { POSITIVE, NEGATIVE } from "../../config/colors";

describe("buildTooltip", () => {
  const mockCandles = [
    {
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
      time: "2025-01-15T09:30:00",
      date: "2025-01-15",
      time_str: "09:30",
    },
    {
      open: 105,
      high: 108,
      low: 103,
      close: 107,
      volume: 800,
      time: "2025-01-15T09:31:00",
      date: "2025-01-15",
      time_str: "09:31",
    },
  ];

  describe("live position tooltip", () => {
    it("renders live position when data item has isLive flag", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            isLive: true,
            trade: {
              side: "BUY",
              entry_price: 100,
              current_price: 105,
              quantity: 10,
              stop_loss: 98,
              take_profit: 110,
              pnl: 50,
              pnl_pct: 5.0,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain("LIVE POSITION");
      expect(result).toContain("BUY");
      expect(result).toContain("Entry: <b>₹100.00</b>");
      expect(result).toContain("Current: <b>₹105.00</b>");
      expect(result).toContain("Qty: 10");
      expect(result).toContain("SL: ₹98.00");
      expect(result).toContain("TP: ₹110.00");
      expect(result).toContain("P&L: ₹50 (+5.00%)");
    });

    it("colors P&L green for profit", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            isLive: true,
            trade: {
              pnl: 100,
              pnl_pct: 10,
              entry_price: 100,
              current_price: 110,
              stop_loss: 95,
              take_profit: 120,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain(`color:${POSITIVE}`);
    });

    it("colors P&L red for loss", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            isLive: true,
            trade: {
              pnl: -50,
              pnl_pct: -5,
              entry_price: 100,
              current_price: 95,
              stop_loss: 98,
              take_profit: 90,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain(`color:${NEGATIVE}`);
    });

    it("handles missing optional fields gracefully", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            isLive: true,
            trade: {
              side: "SELL",
              entry_price: 200,
              current_price: 0,
              stop_loss: 0,
              take_profit: 0,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain("SELL");
      expect(result).toContain("Entry: <b>₹200.00</b>");
    });
  });

  describe("trade tooltip", () => {
    it("renders completed trade when trade object present", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            trade: {
              id: 42,
              side: "BUY",
              entry_price: 100,
              exit_price: 110,
              quantity: 5,
              exit_reason: "TP",
              pnl: 50,
              costs: 2,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain("Trade #42");
      expect(result).toContain("BUY | TP");
      expect(result).toContain("Entry: <b>₹100.00</b>");
      expect(result).toContain("Exit: <b>₹110.00</b>");
      expect(result).toContain("Qty: 5");
      expect(result).toContain("P&L: +₹50");
      expect(result).toContain("Cost: ₹2");
    });

    it("handles trades without exit (still open)", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            trade: {
              id: 1,
              entry_price: 100,
              exit_price: 0,
              exit_reason: "Open",
              quantity: 1,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain("Trade #1");
      expect(result).toContain("Open");
    });

    it("handles exit_reason undefined", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            trade: {
              id: 1,
              entry_price: 100,
              exit_price: 0,
              quantity: 1,
            },
          },
        },
      ];
      const result = formatter(params);
      expect(result).toContain("Open");
    });
  });

  describe("holiday gap tooltip", () => {
    it("renders holiday info when hasGaps is true and extendedTimeData provided", () => {
      const holidays = [{ date: "2025-01-16", type: "trading", description: "Trading holiday" }];
      const holidayMap = buildHolidayMap(holidays);
      const extendedTimeData = ["2025-01-15 09:30", "2025-01-16 [H]"];
      const formatter = buildTooltip(mockCandles, holidays, extendedTimeData, true, holidayMap);

      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 1, // Points to holiday entry
        },
      ];
      const result = formatter(params);
      expect(result).toContain("2025-01-16 — Trading Holiday");
      expect(result).toContain("Trading holiday");
    });

    it("handles clearing holiday type", () => {
      const holidays = [{ date: "2025-01-16", type: "clearing", description: "Clearing holiday" }];
      const holidayMap = buildHolidayMap(holidays);
      const extendedTimeData = ["2025-01-15 09:30", "2025-01-16 [C]"];
      const formatter = buildTooltip(mockCandles, holidays, extendedTimeData, true, holidayMap);

      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 1,
        },
      ];
      const result = formatter(params);
      expect(result).toContain("2025-01-16 — Clearing Holiday");
      expect(result).toContain("Clearing holiday");
    });

    it("shows weekend when no holiday info in map", () => {
      const extendedTimeData = ["2025-01-15 09:30", "2025-01-17 [W]"]; // Sunday
      const formatter = buildTooltip(mockCandles, undefined, extendedTimeData, true);

      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 1,
        },
      ];
      const result = formatter(params);
      expect(result).toContain("Weekend");
    });

    it("returns empty string when no params", () => {
      const formatter = buildTooltip(mockCandles);
      const result = formatter([]);
      expect(result).toBe("");
    });

    it("returns empty string when params is null/undefined", () => {
      const formatter = buildTooltip(mockCandles);
      // @ts-expect-error testing edge case
      const result = formatter(null);
      expect(result).toBe("");
    });
  });

  describe("regular candle tooltip", () => {
    it("displays candle OHLC values", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 0,
        },
      ];
      const result = formatter(params);
      expect(result).toContain("O: ₹100.00");
      expect(result).toContain("H: ₹110.00");
      expect(result).toContain("L: ₹95.00");
      expect(result).toContain("C: ₹105.00");
    });

    it("does not display volume", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 0,
        },
      ];
      const result = formatter(params);
      expect(result).not.toContain("Vol:");
    });

    it("does not display volume for large volumes", () => {
      const candlesWithLargeVolume = [{ ...mockCandles[0], volume: 1500000 }];
      const formatter = buildTooltip(candlesWithLargeVolume);
      const params = [{ seriesType: "candlestick", dataIndex: 0 }];
      const result = formatter(params);
      expect(result).not.toContain("Vol:");
    });

    it("shows positive change in green", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 0,
        },
      ];
      const result = formatter(params);
      expect(result).toContain(`color:${POSITIVE}`); // palette green for bullish
      expect(result).toContain("+5.00%"); // (105-100)/100 = 5%
    });

    it("shows negative change in red", () => {
      const bearishCandle = {
        ...mockCandles[1],
        open: 108,
        close: 105,
      };
      const formatter = buildTooltip([bearishCandle]);
      const params = [{ seriesType: "candlestick", dataIndex: 0 }];
      const result = formatter(params);
      expect(result).toContain(`color:${NEGATIVE}`); // palette red for bearish
    });

    it("formats time label with date when date exists", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 0,
        },
      ];
      const result = formatter(params);
      expect(result).toContain("2025-01-15 09:30");
    });

    it("uses time_str when available", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 0,
        },
      ];
      const result = formatter(params);
      // Should use time_str which is "09:30"
      expect(result).toContain("09:30");
    });

    it("falls back to parsing time when time_str missing", () => {
      const candleWithoutTimeStr = {
        ...mockCandles[0],
        time: "2025-01-15T09:30:00",
      };
      delete (candleWithoutTimeStr as any).time_str;
      const formatter = buildTooltip([candleWithoutTimeStr]);
      const params = [{ seriesType: "candlestick", dataIndex: 0 }];
      const result = formatter(params);
      // When date is present, timeLabel includes date
      expect(result).toContain("2025-01-15");
    });

    it("returns empty string when candle not found", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          seriesType: "candlestick",
          dataIndex: 999,
        },
      ];
      const result = formatter(params);
      expect(result).toBe("");
    });
  });

  describe("parameter handling", () => {
    it("prioritizes live position over trade", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [
        {
          data: {
            isLive: true,
            trade: {
              side: "BUY",
              entry_price: 100,
            },
          },
        },
        {
          data: {
            trade: {
              id: 1,
              entry_price: 100,
            },
          },
        },
      ];
      const result = formatter(params);
      // Should return live position, not trade
      expect(result).toContain("LIVE POSITION");
      expect(result).not.toContain("Trade #");
    });

    it("iterates through params to find match", () => {
      const formatter = buildTooltip(mockCandles);
      const params = [{ data: {} }, { data: { trade: { id: 1, entry_price: 100 } } }];
      const result = formatter(params);
      expect(result).toContain("Trade #1");
    });
  });
});
