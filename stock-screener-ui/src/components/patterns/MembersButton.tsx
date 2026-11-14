import { IconUsers } from "@/patterns/icons";

export interface MembersButtonProps {
  symbol: string;
  testId: string;
  onShowMembers?: (symbol: string) => void;
  /** Hit area in px (16 list / 14 matrix). */
  size?: number;
  iconSize?: number;
}

/** Small index-members trigger rendered next to a symbol link. */
export function MembersButton(props: MembersButtonProps) {
  const size = () => props.size ?? 16;
  return (
    <button
      type="button"
      title={`View ${props.symbol} members`}
      aria-label={`View ${props.symbol} members`}
      data-testid={props.testId}
      onClick={(event) => {
        event.stopPropagation();
        props.onShowMembers?.(props.symbol);
      }}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-fin-text-muted transition-colors hover:text-fin-primary"
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <IconUsers size={props.iconSize ?? 12} />
    </button>
  );
}
