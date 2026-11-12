import { Loader } from "@/ui";
import { EmptyCompact } from "../common/states";
import type { ScreenerLoadingProps } from "./types";

export function ScreenerLoading(props: ScreenerLoadingProps) {
  return (
    <EmptyCompact
      id="screener-loading"
      data-testid="screener-loading"
      icon={<Loader size="sm" data-testid="screener-loader" />}
      title="Loading screener"
      description={props.message}
    />
  );
}
