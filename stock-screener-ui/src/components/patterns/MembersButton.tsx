import { Box } from "@/ui";
import { IconUsers } from "@tabler/icons-react";

export interface MembersButtonProps {
  symbol: string;
  testId: string;
  onShowMembers?: (symbol: string) => void;
  /** Hit area in px (16 list / 14 matrix). */
  size?: number;
  iconSize?: number;
}

/** Small index-members trigger rendered next to a symbol link. */
export function MembersButton({
  symbol,
  testId,
  onShowMembers,
  size = 16,
  iconSize = 12,
}: MembersButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      title={`View ${symbol} members`}
      aria-label={`View ${symbol} members`}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation();
        onShowMembers?.(symbol);
      }}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        p: 0,
        border: 0,
        bgcolor: "transparent",
        color: "text.secondary",
        cursor: "pointer",
        flexShrink: 0,
        "&:hover": { color: "primary.main" },
      }}
    >
      <IconUsers size={iconSize} />
    </Box>
  );
}
