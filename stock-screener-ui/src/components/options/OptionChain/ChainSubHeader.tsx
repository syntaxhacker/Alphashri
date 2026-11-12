import { Box } from "@/ui";
import { getStyles } from "./chainStyles";
import type { CSSProperties } from "solid-js";

interface ChainSubHeaderProps {
  styles: ReturnType<typeof getStyles>;
}

export function ChainSubHeader(props: ChainSubHeaderProps) {
  // TABLE_CHECKLIST rule: numeric columns right, strike/badge center.
  const numericHeader: CSSProperties = {
    ...props.styles.subHeaderCell,
    display: "flex",
    "align-items": "center",
    "justify-content": "flex-end",
    "text-align": "right",
    gap: 8,
    padding: 8,
  };
  const strikeHeader: CSSProperties = {
    ...props.styles.subHeaderCell,
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    "text-align": "center",
    gap: 8,
    padding: 8,
  };
  return (
    <Box
      className="chain-table-subheader"
      style={{ ...props.styles.subHeader, display: "grid", gap: 8, padding: 8 } as CSSProperties}
      data-testid="options-chain-table-subheader"
    >
      <Box style={numericHeader}>OI</Box>
      <Box style={numericHeader}>OI CHG</Box>
      <Box style={numericHeader}>VOL</Box>
      <Box style={numericHeader}>IV</Box>
      <Box style={numericHeader}>LTP</Box>
      <Box style={strikeHeader}></Box>
      <Box style={numericHeader}>LTP</Box>
      <Box style={numericHeader}>IV</Box>
      <Box style={numericHeader}>VOL</Box>
      <Box style={numericHeader}>OI CHG</Box>
      <Box style={numericHeader}>OI</Box>
    </Box>
  );
}
