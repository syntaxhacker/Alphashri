/**
 * Inline-SVG Tabler icons implemented as plain Solid components.
 *
 * `@tabler/icons-react` builds its exports with React's `forwardRef`, and a
 * forwardRef object is not callable, so Solid's `createComponent` throws
 * "Comp is not a function" wherever those icons are rendered. Path data below
 * is copied from Tabler Icons (MIT, https://tabler.io/icons) and rendered as
 * native SVG: 24×24 viewBox, `stroke="currentColor"`, `stroke-width="2"`,
 * round caps/joins.
 */
import { For, splitProps, type JSX } from "solid-js";

export interface TablerIconProps extends Omit<JSX.SvgSVGAttributes<SVGSVGElement>, "color" | "stroke"> {
  size?: number | string;
  /** Stroke width in px (SVG `stroke-width`), not the stroke colour. */
  stroke?: number | string;
  color?: string;
  className?: string;
}

function makeIcon(paths: string[]) {
  return function TablerIcon(props: TablerIconProps) {
    const [local, rest] = splitProps(props, ["size", "stroke", "color", "className"]);
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
        class={(local.className ?? (rest as any).class) as string | undefined}
        {...rest}
      >
        <For each={paths}>{(d) => <path d={d} />}</For>
      </svg>
    );
  };
}

export const IconCopy = makeIcon(["M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666","M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"]);
export const IconCheck = makeIcon(["M5 12l5 5l10 -10"]);
export const IconTrendingUp = makeIcon(["M3 17l6 -6l4 4l8 -8","M14 7l7 0l0 7"]);
export const IconChartDots = makeIcon(["M3 3v18h18","M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M17 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M12 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M10.16 10.62l2.34 2.88","M15.088 13.328l2.837 -4.586"]);
export const IconWorld = makeIcon(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M3.6 9h16.8","M3.6 15h16.8","M11.5 3a17 17 0 0 0 0 18","M12.5 3a17 17 0 0 1 0 18"]);
export const IconSettings = makeIcon(["M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065","M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"]);
export const IconNetwork = makeIcon(["M6 9a6 6 0 1 0 12 0a6 6 0 0 0 -12 0","M12 3c1.333 .333 2 2.333 2 6s-.667 5.667 -2 6","M12 3c-1.333 .333 -2 2.333 -2 6s.667 5.667 2 6","M6 9h12","M3 20h7","M14 20h7","M10 20a2 2 0 1 0 4 0a2 2 0 0 0 -4 0","M12 15v3"]);
export const IconLayoutDashboard = makeIcon(["M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1","M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1","M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1","M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1"]);
export const IconDatabaseOff = makeIcon(["M12.983 8.978c3.955 -.182 7.017 -1.446 7.017 -2.978c0 -1.657 -3.582 -3 -8 -3c-1.661 0 -3.204 .19 -4.483 .515m-2.783 1.228c-.471 .382 -.734 .808 -.734 1.257c0 1.22 1.944 2.271 4.734 2.74","M4 6v6c0 1.657 3.582 3 8 3c.986 0 1.93 -.067 2.802 -.19m3.187 -.82c1.251 -.53 2.011 -1.228 2.011 -1.99v-6","M4 12v6c0 1.657 3.582 3 8 3c3.217 0 5.991 -.712 7.261 -1.74m.739 -3.26v-4","M3 3l18 18"]);
export const IconCoins = makeIcon(["M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3","M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4","M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598","M3 6v10c0 .888 .772 1.45 2 2","M3 11c0 .888 .772 1.45 2 2"]);
export const IconChevronUp = makeIcon(["M6 15l6 -6l6 6"]);
export const IconChartLine = makeIcon(["M4 19l16 0","M4 15l4 -6l4 2l4 -5l4 4"]);
export const IconChartCandle = makeIcon(["M4 7a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -3","M6 4l0 2","M6 11l0 9","M10 15a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -3","M12 4l0 10","M12 19l0 1","M16 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -4","M18 4l0 1","M18 11l0 9"]);
export const IconCalendarEvent = makeIcon(["M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12","M16 3l0 4","M8 3l0 4","M4 11l16 0","M8 15h2v2h-2l0 -2"]);
export const IconArrowsExchange = makeIcon(["M7 10h14l-4 -4","M17 14h-14l4 4"]);
export const IconChevronDown = makeIcon(["M6 9l6 6l6 -6"]);
export const IconChevronLeft = makeIcon(["M15 6l-6 6l6 6"]);
export const IconChevronRight = makeIcon(["M9 6l6 6l-6 6"]);
export const IconChartBar = makeIcon(["M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6","M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10","M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14","M4 20h14"]);
export const IconRefresh = makeIcon(["M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4","M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"]);
export const IconClock = makeIcon(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M12 7v5l3 3"]);
export const IconAlertCircle = makeIcon(["M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0","M12 8v4","M12 16h.01"]);
export const IconBellRinging = makeIcon(["M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6","M9 17v1a3 3 0 0 0 6 0v-1","M21 6.727a11.05 11.05 0 0 0 -2.794 -3.727","M3 6.727a11.05 11.05 0 0 1 2.792 -3.727"]);
export const IconTable = makeIcon(["M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14","M3 10h18","M10 3v18"]);
export const IconUsers = makeIcon(["M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2","M16 3.13a4 4 0 0 1 0 7.75","M21 21v-2a4 4 0 0 0 -3 -3.85"]);
export const IconX = makeIcon(["M18 6l-12 12","M6 6l12 12"]);
