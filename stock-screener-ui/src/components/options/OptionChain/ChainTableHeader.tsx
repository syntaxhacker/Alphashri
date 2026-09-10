import Box from "@mui/material/Box";
import type { ThemeType } from "./chainStyles";

interface ChainTableHeaderProps {
  theme: ThemeType;
  styles: ReturnType<typeof import("./chainStyles").getStyles>;
}

export function ChainTableHeader({ theme, styles }: ChainTableHeaderProps) {
  return (
    <Box className="chain-table-header" sx={{ ...styles.header, display: "grid", gap: 1, p: 1 }} data-testid="options-chain-table-header">
      <Box className="chain-header-cell chain-calls-header" sx={{ ...styles.headerCell, color: "success.main", bgcolor: "background.paper", display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
        CALLS (CE)
      </Box>
      <Box className="chain-header-cell chain-strike-header" sx={{ ...styles.headerCell, color: "warning.main", bgcolor: "background.paper", display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
        STRIKE
      </Box>
      <Box className="chain-header-cell chain-puts-header" sx={{ ...styles.headerCell, color: "error.main", bgcolor: "background.paper", display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
        PUTS (PE)
      </Box>
    </Box>
  );
}
