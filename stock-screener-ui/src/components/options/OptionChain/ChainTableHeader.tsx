import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { ThemeType } from "./chainStyles";
import { getStyles } from "./chainStyles";
import type { CSSProperties } from "solid-js";

interface ChainTableHeaderProps {
  /** Accepted for API compatibility; unused by the header itself. */
  theme?: ThemeType;
  styles: ReturnType<typeof getStyles>;
}

export function ChainTableHeader(props: ChainTableHeaderProps) {
  const headerCell = {
    ...props.styles.headerCell,
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    gap: 8,
    padding: 8,
  } as CSSProperties;
  return (
    <Box
      className="chain-table-header"
      style={{ ...props.styles.header, display: "grid", gap: 8, padding: 8 } as CSSProperties}
      data-testid="options-chain-table-header"
    >
      <Box
        className="chain-header-cell chain-calls-header"
        style={{ ...headerCell, color: palette.POSITIVE, "background-color": palette.SURFACE } as CSSProperties}
      >
        CALLS (CE)
      </Box>
      <Box
        className="chain-header-cell chain-strike-header"
        style={{ ...headerCell, color: palette.WARNING, "background-color": palette.SURFACE } as CSSProperties}
      >
        STRIKE
      </Box>
      <Box
        className="chain-header-cell chain-puts-header"
        style={{ ...headerCell, color: palette.NEGATIVE, "background-color": palette.SURFACE } as CSSProperties}
      >
        PUTS (PE)
      </Box>
    </Box>
  );
}
