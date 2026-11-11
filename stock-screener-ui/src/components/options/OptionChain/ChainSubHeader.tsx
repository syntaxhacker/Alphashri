import { Box } from "@/ui";
import { getStyles } from "./chainStyles";

interface ChainSubHeaderProps {
  styles: ReturnType<typeof getStyles>;
}

export function ChainSubHeader({ styles }: ChainSubHeaderProps) {
  // TABLE_CHECKLIST rule: numeric columns right, strike/badge center.
  const numericHeader: React.CSSProperties = {
    ...styles.subHeaderCell,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    textAlign: "right",
    gap: 8,
    padding: 8,
  };
  const strikeHeader: React.CSSProperties = {
    ...styles.subHeaderCell,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: 8,
    padding: 8,
  };
  return (
    <Box
      className="chain-table-subheader"
      style={{ ...styles.subHeader, display: "grid", gap: 8, padding: 8 } as React.CSSProperties}
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
