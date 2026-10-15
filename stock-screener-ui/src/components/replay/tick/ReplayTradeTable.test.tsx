// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReplayTradeTable, type RTrade } from "./ReplayTradeTable";

vi.mock("@/components/common", () => ({
  TanStackTable: ({ data, columns, renderSubComponent, getRowCanExpand, getRowTestId, onRowClick, emptyMessage }: any) => (
    <div data-testid="mock-table">
      {data.length === 0 ? (
        <div>{emptyMessage}</div>
      ) : (
        data.map((row: RTrade, i: number) => (
          <div key={i} data-testid={getRowTestId?.(row, i)} onClick={() => onRowClick?.(row)}>
            {columns.map((c: any) => (
              <span key={c.id} data-testid={`cell-${c.id}`}>
                {c.cell?.({ row: { original: row, getIsExpanded: () => false, toggleExpanded: () => {} } })}
              </span>
            ))}
          </div>
        ))
      )}
      {renderSubComponent && data.length > 0 && (
        <div data-testid="sub">{renderSubComponent(data[0])}</div>
      )}
      {String(!!getRowCanExpand)}
    </div>
  ),
  SideBadge: ({ side }: any) => <span>{side}</span>,
  ExitReasonBadge: ({ reason }: any) => <span>{reason}</span>,
}));

// trade closed at T0+60 (exit revealed when clock >= exit_time)
const T0 = 1788300000;
const closedTrade: RTrade = {
  time: T0, exit_time: T0 + 3600, side: "LONG", kind: "vwap-orb",
  entry: 29062.3, sl: 29034.9, tp: 29076.7, exit: 29076.7,
  result: "TP", pnl: 14.4, rr: 0.5,
};
const openTrade: RTrade = {
  time: T0 + 7200, exit_time: T0 + 10800, side: "SHORT", kind: "vwap-orb",
  entry: 29100.0, sl: 29130.0, tp: 29070.0, exit: 0,
  result: "SL", pnl: 0, rr: 0,
};

describe("ReplayTradeTable", () => {
  test("renders time/side/prices/pnl/R/exit columns for a closed trade", () => {
    render(<ReplayTradeTable trades={[closedTrade]} clock={T0 + 7200} onSelectTime={() => {}} />);
    const row = screen.getByTestId(`replay-trade-row-${T0}-LONG`);
    const q = within(row as HTMLElement);
    expect(q.getByText("LONG")).toBeInTheDocument();
    expect(q.getByText("29062.3")).toBeInTheDocument();   // entry
    expect(q.getByText("29034.9")).toBeInTheDocument();   // SL
    expect(q.getAllByText("29076.7")).toHaveLength(2);    // TP cell + exit cell
    expect(q.getByText("+14.4")).toBeInTheDocument();     // P&L pts
    expect(q.getByText("+0.5R")).toBeInTheDocument();     // R multiple
    expect(q.getByText("TP")).toBeInTheDocument();        // exit badge
    expect(q.getByText("1h")).toBeInTheDocument();        // hold duration
  });

  test("open trade shows ellipsis + OPEN chip, no pnl", () => {
    render(<ReplayTradeTable trades={[openTrade]} clock={T0 + 7300} onSelectTime={() => {}} />);
    const row = screen.getByTestId(`replay-trade-row-${T0 + 7200}-SHORT`);
    const q = within(row as HTMLElement);
    expect(q.getByText("OPEN")).toBeInTheDocument();
    expect(q.queryByTestId(`replay-pnl-${T0 + 7200}`)).not.toBeInTheDocument();
  });

  test("expanded detail shows entry/exit context grid", () => {
    render(<ReplayTradeTable trades={[closedTrade]} clock={T0 + 7200} onSelectTime={() => {}} />);
    const sub = screen.getByTestId("sub");
    const q = within(sub as HTMLElement);
    expect(q.getByText("ENTRY")).toBeInTheDocument();
    expect(q.getByText("EXIT")).toBeInTheDocument();
    expect(q.getByText("27.4 pts")).toBeInTheDocument();  // risk = |entry - sl|
  });

  test("row click jumps the replay clock to entry time", async () => {
    const user = userEvent.setup();
    const onSelectTime = vi.fn();
    render(<ReplayTradeTable trades={[closedTrade]} clock={T0 + 7200} onSelectTime={onSelectTime} />);
    await user.click(screen.getByTestId(`replay-trade-row-${T0}-LONG`));
    expect(onSelectTime).toHaveBeenCalledWith(T0);
  });

  test("empty state prompts to press play", () => {
    render(<ReplayTradeTable trades={[]} clock={0} onSelectTime={() => {}} />);
    expect(screen.getByText(/Press Play/)).toBeInTheDocument();
  });
});
