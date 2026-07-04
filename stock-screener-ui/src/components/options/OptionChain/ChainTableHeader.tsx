import { Box } from "@/ui";
import type { ThemeType } from "./chainStyles";

interface ChainTableHeaderProps {
  theme: ThemeType;
  styles: ReturnType<typeof import("./chainStyles").getStyles>;
}

export function ChainTableHeader({ theme, styles }: ChainTableHeaderProps) {
  return (
    <Box
      className="chain-table-header"
      style={styles.header}
      data-testid="options-chain-table-header"
    >
      <Box
        className="chain-header-cell chain-calls-header"
        style={{
          ...styles.headerCell,
          color: theme.colors.green[8],
          background:
            "linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(20,184,166,0.12) 100%)",
        }}
      >
        CALLS (CE)
      </Box>
      <Box
        className="chain-header-cell chain-strike-header"
        style={{
          ...styles.headerCell,
          color: theme.colors.yellow[9],
          background:
            "linear-gradient(180deg, rgba(250,204,21,0.22) 0%, rgba(253,224,71,0.12) 100%)",
        }}
      >
        STRIKE
      </Box>
      <Box
        className="chain-header-cell chain-puts-header"
        style={{
          ...styles.headerCell,
          color: theme.colors.red[8],
          background:
            "linear-gradient(135deg, rgba(251,113,133,0.12) 0%, rgba(249,115,22,0.14) 100%)",
        }}
      >
        PUTS (PE)
      </Box>
    </Box>
  );
}
