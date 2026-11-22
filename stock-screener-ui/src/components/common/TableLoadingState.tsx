import type { JSX } from "solid-js";
import { InlineLoader } from "./states";

interface TableLoadingStateProps {
  message?: string;
  showSpinner?: boolean;
  children?: JSX.Element;
}

export function TableLoadingState(props: TableLoadingStateProps) {
  return (
    <InlineLoader
      data-testid="table-loading-state"
      size="sm"
      message={props.message ?? "Loading..."}
      showSpinner={props.showSpinner ?? true}
    >
      {props.children}
    </InlineLoader>
  );
}
