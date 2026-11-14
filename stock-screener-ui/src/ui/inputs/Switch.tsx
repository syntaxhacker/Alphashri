import { createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UISwitchProps } from "../types";
import * as palette from "../palette";

type SwitchProps = UISwitchProps;

type TrackBox = { w: number; h: number };

/**
 * A switch is a *track with a knob*: the geometry is fixed per size and the
 * knob travel is derived from it, so it can never render as a checked square.
 */
const TRACK_BOX: Record<string, TrackBox> = {
  xs: { w: 26, h: 14 },
  sm: { w: 30, h: 16 },
  md: { w: 36, h: 20 },
  lg: { w: 36, h: 20 },
  xl: { w: 36, h: 20 },
};

const KNOB_INSET = 1;
const TRACK_BORDER = 1;

function trackBox(size?: UISwitchProps["size"]): TrackBox {
  return TRACK_BOX[String(size)] ?? { w: 36, h: 20 };
}

/** 36×20 track → 16px knob; both derived so no size can drift out of round. */
function knobSide(box: TrackBox): number {
  return box.h - TRACK_BORDER * 2 - KNOB_INSET * 2;
}

function knobTravel(box: TrackBox): number {
  return box.w - TRACK_BORDER * 2 - KNOB_INSET * 2 - knobSide(box);
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
    case "success":
      return palette.POSITIVE;
    default:
      return palette.PRIMARY;
  }
}

export function Switch(props: SwitchProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
    "size",
    "color",
    "error",
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
  const [focused, setFocused] = createSignal(false);
  const isOn = createMemo(() => (isControlled() ? known.checked === true : internal()));
  const isError = createMemo(() => Boolean(known.error));

  const handleChange = (e: Event & { currentTarget: HTMLInputElement; target: Element }) => {
    const next = e.currentTarget.checked;
    if (!isControlled()) setInternal(next);
    known.onChange?.(e);
  };

  const trackStyle = createMemo<Record<string, string>>(() => {
    const box = trackBox(known.size);
    const tone = toneColor(known.color);
    const fill = known.disabled ? palette.SURFACE_ALT : isOn() ? tone : palette.SURFACE_ALT;
    const border = isError()
      ? palette.NEGATIVE
      : focused()
        ? palette.PRIMARY
        : isOn() && !known.disabled
          ? tone
          : palette.BORDER;
    return {
      width: `${box.w}px`,
      height: `${box.h}px`,
      display: "inline-block",
      position: "relative",
      "flex-shrink": "0",
      "border-radius": "9999px",
      border: `1px solid ${border}`,
      "box-shadow": focused() ? `0 0 0 1px ${palette.PRIMARY}` : "none",
      "background-color": fill,
      transition: "background-color 120ms linear, border-color 120ms linear",
      cursor: known.disabled ? "not-allowed" : "pointer",
    };
  });

  const knobStyle = createMemo<Record<string, string>>(() => {
    const box = trackBox(known.size);
    return {
      width: `${knobSide(box)}px`,
      height: `${knobSide(box)}px`,
      "border-radius": "9999px",
      "background-color": isOn() ? (known.disabled ? palette.TEXT_MUTED : palette.BG) : palette.TEXT_MUTED,
      position: "absolute",
      top: "50%",
      left: `${KNOB_INSET}px`,
      // The knob's position — not its colour — carries the state when disabled.
      transform: `translateY(-50%) translateX(${isOn() ? knobTravel(box) : 0}px)`,
      transition: "transform 120ms linear, background-color 120ms linear",
      "pointer-events": "none",
    };
  });

  const rootClass = createMemo(() =>
    cn(
      "inline-flex items-center gap-2 leading-none",
      known.disabled ? "opacity-[0.45] cursor-not-allowed" : undefined,
      known.className,
    ),
  );

  const control = (
    <span
      role="presentation"
      data-part="switch-track"
      className="relative inline-block shrink-0"
      style={trackStyle()}
    >
      <input
        type="checkbox"
        role="switch"
        checked={isOn()}
        disabled={known.disabled}
        id={known.id}
        data-testid={known["data-testid"]}
        className="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span aria-hidden="true" data-part="switch-knob" style={knobStyle()} />
    </span>
  );

  if (!known.label && !known.description) {
    return (
      <span
        className={cn("inline-flex items-center", known.disabled && "opacity-[0.45] cursor-not-allowed", known.className)}
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
