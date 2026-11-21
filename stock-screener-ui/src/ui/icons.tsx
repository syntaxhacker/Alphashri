/**
 * Inline-SVG Tabler icons implemented as plain Solid components.
 *
 * `@tabler/icons-react` builds its exports with React's `forwardRef`, and a
 * forwardRef object is not callable, so Solid's `createComponent` throws
 * "Comp is not a function" wherever those icons are rendered. Path data below
 * is copied from Tabler Icons (MIT) and rendered as native SVG: 24×24 viewBox,
 * `stroke="currentColor"`, `stroke-width="2"`, round caps/joins.
 */
import { splitProps, type JSX } from "solid-js";

export interface TablerIconProps extends Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "color"> {
  size?: number | string;
  stroke?: number | string;
  color?: string;
}

function makeIcon(paths: string[]) {
  // A path's `d` is self-delimiting, so every subpath concatenates into one
  // `d` that paints identically with a single DOM node — these icons repeat
  // once per card in the results grid, where 8 nodes each is real work.
  const merged = paths.join("");
  return function TablerIcon(props: TablerIconProps) {
    const [local, rest] = splitProps(props, ["size", "stroke", "color"]);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={local.size ?? 24}
        height={local.size ?? 24}
        viewBox="0 0 24 24"
        fill="none"
        stroke={local.color ?? "currentColor"}
        stroke-width={local.stroke ?? 2}
        stroke-linecap="round"
        stroke-linejoin="round"
        {...rest}
      >
        <path d={merged} />
      </svg>
    );
  };
}

export const IconRefresh = makeIcon([
  "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4",
  "M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4",
]);

export const IconAlertCircle = makeIcon([
  "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
  "M12 8v4",
  "M12 16h.01",
]);

export const IconTable = makeIcon([
  "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14",
  "M3 10h18",
  "M10 3v18",
]);

export const IconChartBar = makeIcon([
  "M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6",
  "M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10",
  "M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14",
  "M4 20h14",
]);

export const IconHelpCircle = makeIcon([
  "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
  "M12 16v.01",
  "M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483",
]);

export const IconClock = makeIcon([
  "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
  "M12 7v5l3 3",
]);

export const IconTarget = makeIcon([
  "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  "M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0",
  "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
]);

export const IconArrowUp = makeIcon([
  "M12 5l0 14",
  "M18 11l-6 -6",
  "M6 11l6 -6",
]);

export const IconArrowDown = makeIcon([
  "M12 5l0 14",
  "M18 13l-6 6",
  "M6 13l6 6",
]);

export const IconBellRinging = makeIcon([
  "M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6",
  "M9 17v1a3 3 0 0 0 6 0v-1",
  "M21 6.727a11.05 11.05 0 0 0 -2.794 -3.727",
  "M3 6.727a11.05 11.05 0 0 1 2.792 -3.727",
]);

export const IconBolt = makeIcon([
  "M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11",
]);

export const IconWall = makeIcon([
  "M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12",
  "M4 8h16",
  "M20 12h-16",
  "M4 16h16",
  "M9 4v4",
  "M14 8v4",
  "M8 12v4",
  "M16 12v4",
  "M11 16v4",
]);

export const IconActivity = makeIcon([
  "M3 12h4l3 8l4 -16l3 8h4",
]);

export const IconX = makeIcon([
  "M18 6l-12 12",
  "M6 6l12 12",
]);

export const IconUsers = makeIcon([
  "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
  "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
  "M16 3.13a4 4 0 0 1 0 7.75",
  "M21 21v-2a4 4 0 0 0 -3 -3.85",
]);

export const IconArrowsMaximize = makeIcon([
  "M16 4l4 0l0 4",
  "M14 10l6 -6",
  "M8 20l-4 0l0 -4",
  "M4 20l6 -6",
  "M16 20l4 0l0 -4",
  "M14 14l6 6",
  "M8 4l-4 0l0 4",
  "M4 4l6 6",
]);

export const IconRestore = makeIcon([
  "M3.06 13a9 9 0 1 0 .49 -4.087",
  "M3 4.001v5h5",
  "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
]);

export const IconTrash = makeIcon([
  "M4 7l16 0",
  "M10 11l0 6",
  "M14 11l0 6",
  "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12",
  "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",
]);

export const IconUpload = makeIcon([
  "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2",
  "M7 9l5 -5l5 5",
  "M12 4l0 12",
]);

export const IconChevronDown = makeIcon([
  "M6 9l6 6l6 -6",
]);

export const IconBookmarkPlus = makeIcon([
  "M12 17l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v5",
  "M16 19h6",
  "M19 16v6",
]);

export const IconSearch = makeIcon([
  "M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0",
  "M21 21l-6 -6",
]);

export const IconAlertTriangle = makeIcon([
  "M12 9v4",
  "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0",
  "M12 16h.01",
]);

export const IconClipboardText = makeIcon([
  "M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2",
  "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2",
  "M9 12h6",
  "M9 16h6",
]);

export const IconPencil = makeIcon([
  "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4",
  "M13.5 6.5l4 4",
]);

export const IconPlayerPlay = makeIcon([
  "M7 4v16l13 -8l-13 -8",
]);

export const IconChevronLeft = makeIcon([
  "M15 6l-6 6l6 6",
]);

export const IconChevronRight = makeIcon([
  "M9 6l6 6l-6 6",
]);
