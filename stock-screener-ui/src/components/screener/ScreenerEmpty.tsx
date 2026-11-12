import { IconDatabaseOff } from "@tabler/icons-react";
import { EmptyCompact } from "../common/states";
import type { ScreenerEmptyProps } from "./types";

export function ScreenerEmpty(props: ScreenerEmptyProps) {
  const message = () => props.message ?? "No results found";
  return (
    <EmptyCompact
      id="screener-empty"
      data-testid="screener-empty"
      icon={<IconDatabaseOff size={18} stroke={1.7} />}
      title="No results found"
      description={message()}
    />
  );
}
