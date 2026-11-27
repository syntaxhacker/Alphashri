import { Portal as SolidPortal } from "solid-js/web";
import type { UIPortalProps } from "../types";

export function Portal(props: UIPortalProps) {
  const container =
    typeof props.target === "string"
      ? typeof document !== "undefined"
        ? document.querySelector(props.target)
        : undefined
      : props.target;

  // `Portal` is a component in Solid, not a `createPortal` function — the
  // mount node is resolved here and re-read if the caller changes it.
  return (
    <SolidPortal mount={container ?? document.body}>
      {props.children}
    </SolidPortal>
  );
}