import { For } from "solid-js";
import { Box } from "@/ui";
import { getStyles } from "./chainStyles";
import type { JSX } from "solid-js";
type CSSProperties = JSX.CSSProperties;

interface ChainSubHeaderProps {
  styles: ReturnType<typeof getStyles>;
  /** Show only the decision-relevant OI/LTP columns on a phone. */
  compact?: boolean;
}

export function ChainSubHeader(props: ChainSubHeaderProps) {
  // TABLE_CHECKLIST rule: numeric columns right, strike/badge center.
  const numericHeader = (): CSSProperties =>
    ({
      ...props.styles.subHeaderCell,
      display: "flex",
      "align-items": "center",
      "justify-content": "flex-end",
      "text-align": "right",
      gap: "8px",
      padding: "8px",
    }) as CSSProperties;
  const strikeHeader = (): CSSProperties =>
    ({
      ...props.styles.subHeaderCell,
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "text-align": "center",
      gap: "8px",
      padding: "8px",
      // Matches the sticky strike column in the header and in every row.
      position: "sticky",
      left: props.styles.strikeCell?.left ?? "calc(50% - 40px)",
      "z-index": 11,
    }) as CSSProperties;
  const compact = () => !!props.compact;
  const labels = () =>
    compact()
      ? ["OI", "LTP", "", "LTP", "OI"]
      : ["OI", "OI CHG", "VOL", "IV", "LTP", "", "LTP", "IV", "VOL", "OI CHG", "OI"];
  const strikeIndex = () => (compact() ? 2 : 5);

  return (
    <Box
      className="chain-table-subheader"
      style={
        {
          ...props.styles.subHeader,
          display: "grid",
          gap: props.styles.subHeader.gap ?? "8px",
          padding: props.styles.subHeader.padding ?? "8px",
        } as CSSProperties
      }
      data-testid="options-chain-table-subheader"
    >
      <For each={labels()}>
        {(label, index) => (
          <Box
            style={index() === strikeIndex() ? strikeHeader() : numericHeader()}
            data-testid={index() === strikeIndex() ? "options-chain-strike-subheader" : undefined}
          >
            {label}
          </Box>
        )}
      </For>
    </Box>
  );
}
