import { Box } from "@/ui";

interface ChainSubHeaderProps {
  styles: ReturnType<typeof import("./chainStyles").getStyles>;
}

export function ChainSubHeader({ styles }: ChainSubHeaderProps) {
  return (
    <Box
      className="chain-table-subheader"
      style={styles.subHeader}
      data-testid="options-chain-table-subheader"
    >
      <Box style={styles.subHeaderCell}>OI</Box>
      <Box style={styles.subHeaderCell}>OI CHG</Box>
      <Box style={styles.subHeaderCell}>VOL</Box>
      <Box style={styles.subHeaderCell}>IV</Box>
      <Box style={styles.subHeaderCell}>LTP</Box>
      <Box style={styles.subHeaderCell}></Box>
      <Box style={styles.subHeaderCell}>LTP</Box>
      <Box style={styles.subHeaderCell}>IV</Box>
      <Box style={styles.subHeaderCell}>VOL</Box>
      <Box style={styles.subHeaderCell}>OI CHG</Box>
      <Box style={styles.subHeaderCell}>OI</Box>
    </Box>
  );
}
