import { For, Show, children as resolveChildren, createUniqueId, type JSX } from "solid-js";
import { MONO, PRIMARY, SURFACE } from "@/ui/palette";
import { SVG_TEXT } from "../shared";

export interface MatrixRailRow {
  label: string;
  title?: string;
}

export interface MatrixRowRail {
  rows: MatrixRailRow[];
  labelWidth: number;
  headerHeight: number;
  rowHeight: number;
  footerHeight?: number;
}

export interface MatrixFrameProps {
  title: string;
  desc: string;
  width: number;
  height: number;
  testId: string;
  /** Extra element id(s) appended after the generated title and desc ids. */
  labelledBy?: string;
  children?: JSX.Element;
  empty?: JSX.Element;
  className?: string;
  style?: JSX.CSSProperties;
  "data-top3"?: boolean | string;
  rowRail?: MatrixRowRail;
}

/** Shared labelled SVG shell with an optional empty state and sticky row rail. */
export function MatrixFrame(props: MatrixFrameProps) {
  const uid = createUniqueId();
  const titleId = `matrix-title-${uid}`;
  const descId = `matrix-desc-${uid}`;
  const frameClass = `matrix-frame-${uid}`;

  const content = resolveChildren(() => props.children);
  const empty = resolveChildren(() => props.empty);

  const labelledBy = () => [titleId, descId, props.labelledBy?.trim()].filter(Boolean).join(" ");

  const top3 = () => {
    const value = props["data-top3"];
    if (value === undefined) return undefined;
    return typeof value === "boolean" ? String(value) : value;
  };

  return (
    <div
      data-testid={`${props.testId}-frame`}
      data-top3={top3()}
      class={`min-w-0 ${frameClass}${props.className ? ` ${props.className}` : ""}`}
      style={{
        position: "relative",
        width: "100%",
        "min-width": `${props.width}px`,
        ...props.style,
      }}
    >
      <style>{`.${frameClass} [data-cell]:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: -2px; }`}</style>
      <svg
        data-testid={props.testId}
        data-top3={top3()}
        width="100%"
        viewBox={`0 0 ${props.width} ${props.height}`}
        preserveAspectRatio="xMinYMin meet"
        role="img"
        aria-labelledby={labelledBy()}
        font-family={MONO}
        font-size={SVG_TEXT}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          "min-width": `${props.width}px`,
          "max-width": `${props.width}px`,
        }}
      >
        <title id={titleId}>{props.title}</title>
        <desc id={descId}>{props.desc}</desc>
        <rect width={props.width} height={props.height} fill={SURFACE} />
        <Show
          when={content()}
          fallback={
            <Show when={empty()}>
              <g data-testid={`${props.testId}-empty`}>{empty()}</g>
            </Show>
          }
        >
          {content()}
        </Show>
      </svg>

      <Show when={props.rowRail && props.rowRail.rows.length > 0 ? props.rowRail : undefined}>
        {(rail) => (
          <div
            data-testid={`${props.testId}-row-rail`}
            aria-hidden="true"
            style={{
              position: "sticky",
              left: "0px",
              width: `${rail().labelWidth}px`,
              height: `${rail().headerHeight + rail().rows.length * rail().rowHeight}px`,
              "margin-top": `-${props.height}px`,
              "margin-bottom": `${rail().footerHeight ?? 0}px`,
              "z-index": "2",
              "background-color": SURFACE,
              "pointer-events": "none",
            }}
          >
            <For each={rail().rows}>
              {(row, index) => (
                <div
                  title={row.title ?? row.label}
                  class="absolute flex w-full items-center justify-end overflow-hidden border-r border-fin-border pr-1.5 font-mono text-ui-micro whitespace-nowrap text-fin-text-muted"
                  style={{
                    top: `${rail().headerHeight + index() * rail().rowHeight}px`,
                    height: `${rail().rowHeight}px`,
                    "box-sizing": "border-box",
                  }}
                >
                  {row.label}
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
}
