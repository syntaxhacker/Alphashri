import { createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISwitchProps } from "../types";
import * as palette from "../palette";

type TrackBox = { w: number; h: number };

const TRACK_BOX: Record<string, TrackBox> = {
  xs: { w: 22, h: 12 },
  sm: { w: 26, h: 14 },
  md: { w: 30, h: 16 },
  lg: { w: 36, h: 18 },
  xl: { w: 36, h: 18 },
};

function trackBox(size?: UISwitchProps["size"]): TrackBox {
  return TRACK_BOX[String(size)] ?? { w: 30, h: 16 };
}

function toneColor(color?: UISwitchProps["color"]): string {
  switch (color) {
    case "error":
    case "danger":
      return palette.NEGATIVE;
    case "warning":
      return palette.WARNING;
    case "info":
      return palette.INFO;
    case "secondary":
      return palette.TEXT_MUTED;
    case "primary":
      return palette.PRIMARY;
    default:
      return palette.POSITIVE;
  }
}

export function Switch(props: UISwitchProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
    "size",
    "color",
    "onLabel",
    "offLabel",
    "description",
    "className",
    "style",
    "id",
    "data-testid",
    "children",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  const isControlled = createMemo(() => known.checked !== undefined);
  const [internal, setInternal] = createSignal(known.defaultChecked ?? false);
  const isOn = createMemo(() => (isControlled() ? known.checked === true : internal()));

  const handleChange = (e: Event & { currentTarget: HTMLInputElement; target: Element }) => {
    const next = e.currentTarget.checked;
    if (!isControlled()) setInternal(next);
    known.onChange?.(e);
  };

  const trackStyle = createMemo<Record<string, string>>(() => {
    const box = trackBox(known.size);
    const on = isOn();
    const tone = toneColor(known.color);
    return {
      width: `${box.w}px`,
      height: `${box.h}px`,
      padding: "2px",
      "border-radius": "2px",
      border: `1px solid ${on ? tone : palette.BORDER_COLOR}`,
      "background-color": on ? tone : palette.SURFACE_ALT,
      "justify-content": on ? "flex-end" : "flex-start",
      transition: "background-color 120ms linear, border-color 120ms linear",
    };
  });

  const thumbStyle = createMemo<Record<string, string>>(() => {
    const box = trackBox(known.size);
    const side = `${box.h - 6}px`;
    const on = isOn();
    return {
      width: side,
      height: side,
      "border-radius": "1px",
      "background-color": on ? palette.BG_COLOR : palette.TEXT_MUTED_COLOR,
      "flex": "0 0 auto",
    };
  });

  const rootClass = createMemo(() =>
    cn("inline-flex items-center gap-2 leading-none", known.disabled && "opacity-50", known.className),
  );

  const control = (
    <span
      role="presentation"
      className={cn("relative inline-flex shrink-0 items-center", known.disabled && "cursor-not-allowed")}
      style={trackStyle()}
    >
      <input
        type="checkbox"
        role="switch"
        checked={isOn()}
        disabled={known.disabled}
        id={known.id}
        data-testid={known["data-testid"]}
        className="sr-only"
        onChange={handleChange}
      />
      <span aria-hidden="true" style={thumbStyle()} />
    </span>
  );

  if (!known.label && !known.description) {
    return (
      <span
        className={cn("inline-flex items-center", known.className)}
        data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined}
        style={known.style}
      >
        {control}
      </span>
    );
  }

  return (
    <label
      className={rootClass()}
      style={known.style}
      data-testid={known["data-testid"] ? `${known["data-testid"]}-group` : undefined}
    >
      {control}
      <span className="flex flex-col gap-0.5">
        {known.label ? (
          <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-fin-text-muted leading-none">
            {known.label}
          </span>
        ) : null}
        {known.description ? (
          <span className="text-[10px] text-fin-text-muted leading-none">{known.description}</span>
        ) : null}
      </span>
    </label>
  );
}
