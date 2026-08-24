import Box from "@mui/material/Box";

interface ChainSubHeaderProps {
  styles: ReturnType<typeof import("./chainStyles").getStyles>;
}

export function ChainSubHeader({ styles }: ChainSubHeaderProps) {
  return (
    <Box className="chain-table-subheader" sx={{ ...styles.subHeader, display: "grid", gap: 1, p: 1 }} data-testid="options-chain-table-subheader">
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>OI</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>OI CHG</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>VOL</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>IV</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>LTP</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}></Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>LTP</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>IV</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>VOL</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>OI CHG</Box>
      <Box sx={{ ...styles.subHeaderCell, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>OI</Box>
    </Box>
  );
}
