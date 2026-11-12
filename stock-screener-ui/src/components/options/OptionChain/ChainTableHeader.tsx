import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { ThemeType } from "./chainStyles";
import { getStyles } from "./chainStyles";

interface ChainTableHeaderProps {
  _theme: ThemeType;
  styles: ReturnType<typeof getStyles>;
}

export function ChainTableHeader({ _theme, styles }: ChainTableHeaderProps) {
  const headerCell = {
    ...styles.headerCell,
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    gap: 8,
    padding: 8,
  } as React.CSSProperties;
  return (
    <Box
      className="chain-table-header"
      style={{ ...styles.header, display: "grid", gap: 8, padding: 8 } as React.CSSProperties}
      data-testid="options-chain-table-header"
    >
      <Box
        className="chain-header-cell chain-calls-header"
        style={{ ...headerCell, color: palette.POSITIVE, "background-color": palette.SURFACE } as React.CSSProperties}
      >
        CALLS (CE)
      </Box>
      <Box
        className="chain-header-cell chain-strike-header"
        style={{ ...headerCell, color: palette.WARNING, "background-color": palette.SURFACE } as React.CSSProperties}
      >
        STRIKE
      </Box>
      <Box
        className="chain-header-cell chain-puts-header"
        style={{ ...headerCell, color: palette.NEGATIVE, "background-color": palette.SURFACE } as React.CSSProperties}
      >
        PUTS (PE)
      </Box>
    </Box>
  );
}
