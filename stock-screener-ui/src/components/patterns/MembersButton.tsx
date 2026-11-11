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
      className="inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted transition-colors hover:text-fin-primary"
      style={{ width: size, height: size }}
    >
      <IconUsers size={iconSize} />
    </Box>
  );
}
