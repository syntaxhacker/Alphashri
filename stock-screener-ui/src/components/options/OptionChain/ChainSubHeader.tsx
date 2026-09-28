import Box from "@mui/material/Box";

interface ChainSubHeaderProps {
  styles: ReturnType<typeof import("./chainStyles").getStyles>;
}

export function ChainSubHeader({ styles }: ChainSubHeaderProps) {
  // TABLE_CHECKLIST rule: numeric columns right, strike/badge center.
  const numericHeader = {
    ...styles.subHeaderCell,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    textAlign: "right" as const,
    gap: 1,
    p: 1,
  };
  const strikeHeader = {
    ...styles.subHeaderCell,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    gap: 1,
    p: 1,
  };
  return (
    <Box className="chain-table-subheader" sx={{ ...styles.subHeader, display: "grid", gap: 1, p: 1 }} data-testid="options-chain-table-subheader">
      <Box sx={numericHeader}>OI</Box>
      <Box sx={numericHeader}>OI CHG</Box>
      <Box sx={numericHeader}>VOL</Box>
      <Box sx={numericHeader}>IV</Box>
      <Box sx={numericHeader}>LTP</Box>
      <Box sx={strikeHeader}></Box>
      <Box sx={numericHeader}>LTP</Box>
      <Box sx={numericHeader}>IV</Box>
      <Box sx={numericHeader}>VOL</Box>
      <Box sx={numericHeader}>OI CHG</Box>
      <Box sx={numericHeader}>OI</Box>
    </Box>
  );
}
