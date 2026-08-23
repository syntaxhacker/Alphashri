import { Box } from "@/ui";
import type { ThemeType } from "./chainStyles";
import { hexToRgba } from "./cellPalette";
import { TRADING_GREEN, TRADING_RED, CREAM } from "../../../config/colors";

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
          color: theme.palette.success.dark,
          background: `linear-gradient(135deg, ${hexToRgba(TRADING_GREEN, 0.14)} 0%, ${hexToRgba(TRADING_GREEN, 0.12)} 100%)`,
        }}
      >
        CALLS (CE)
      </Box>
      <Box
        className="chain-header-cell chain-strike-header"
        style={{
          ...styles.headerCell,
          color: theme.palette.warning.dark,
          background: `linear-gradient(180deg, ${hexToRgba(CREAM, 0.22)} 0%, ${hexToRgba(CREAM, 0.12)} 100%)`,
        }}
      >
        STRIKE
      </Box>
      <Box
        className="chain-header-cell chain-puts-header"
        style={{
          ...styles.headerCell,
          color: theme.palette.error.dark,
          background: `linear-gradient(135deg, ${hexToRgba(TRADING_RED, 0.12)} 0%, ${hexToRgba(TRADING_RED, 0.14)} 100%)`,
        }}
      >
        PUTS (PE)
      </Box>
    </Box>
  );
}
