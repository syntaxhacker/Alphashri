export interface IconProps {
  size?: number | string;
  className?: string;
  "data-testid"?: string;
  color?: string;
  /** Overrides the default stroke width (tabler default is 2). */
  stroke?: number;
}

/**
 * Inline SVG icons generated from @tabler/icons (outline set, MIT).
 * The Solid build has no React DOM, so @tabler/icons-react cannot mount —
 * these render the same tabler path data as plain SVG.
 */
export function Icon(props: IconProps & { name: string }) {
  const node = ICON_NODES[props.name];
  return (
    <svg
      data-testid={props["data-testid"] ?? `icon-${props.name}`}
      class={props.className}
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color ?? "currentColor"}
      stroke-width={props.stroke ?? 2}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {node?.map(([tag, attrs]: [string, Record<string, string>]) => {
        if (tag === "path") return <path d={attrs.d} />;
        if (tag === "circle") return <circle cx={attrs.cx} cy={attrs.cy} r={attrs.r} />;
        if (tag === "line") return <line x1={attrs.x1} y1={attrs.y1} x2={attrs.x2} y2={attrs.y2} />;
        if (tag === "rect") return <rect x={attrs.x} y={attrs.y} width={attrs.width} height={attrs.height} rx={attrs.rx} />;
        if (tag === "polyline") return <polyline points={attrs.points} />;
        if (tag === "polygon") return <polygon points={attrs.points} />;
        if (tag === "ellipse") return <ellipse cx={attrs.cx} cy={attrs.cy} rx={attrs.rx} ry={attrs.ry} />;
        return null;
      })}
    </svg>
  );
}

const ICON_NODES: Record<string, Array<[string, Record<string, string>]>> = {
  "activity": [["path",{"d":"M3 12h4l3 8l4 -16l3 8h4"}]],
  "adjustments": [["path",{"d":"M4 10a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"}],["path",{"d":"M6 4v4"}],["path",{"d":"M6 12v8"}],["path",{"d":"M10 16a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"}],["path",{"d":"M12 4v10"}],["path",{"d":"M12 18v2"}],["path",{"d":"M16 7a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"}],["path",{"d":"M18 4v1"}],["path",{"d":"M18 9v11"}]],
  alertCircle: [["path",{"d":"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"}],["path",{"d":"M12 8v4"}],["path",{"d":"M12 16h.01"}]],
  alertTriangle: [["path",{"d":"M12 9v4"}],["path",{"d":"M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0"}],["path",{"d":"M12 16h.01"}]],
  "archive": [["path",{"d":"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2"}],["path",{"d":"M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10"}],["path",{"d":"M10 12l4 0"}]],
  arrowDown: [["path",{"d":"M12 5l0 14"}],["path",{"d":"M18 13l-6 6"}],["path",{"d":"M6 13l6 6"}]],
  arrowLeft: [["path",{"d":"M5 12l14 0"}],["path",{"d":"M5 12l6 6"}],["path",{"d":"M5 12l6 -6"}]],
  arrowsMaximize: [["path",{"d":"M16 4l4 0l0 4"}],["path",{"d":"M14 10l6 -6"}],["path",{"d":"M8 20l-4 0l0 -4"}],["path",{"d":"M4 20l6 -6"}],["path",{"d":"M16 20l4 0l0 -4"}],["path",{"d":"M14 14l6 6"}],["path",{"d":"M8 4l-4 0l0 4"}],["path",{"d":"M4 4l6 6"}]],
  arrowsMinimize: [["path",{"d":"M5 9l4 0l0 -4"}],["path",{"d":"M3 3l6 6"}],["path",{"d":"M5 15l4 0l0 4"}],["path",{"d":"M3 21l6 -6"}],["path",{"d":"M19 9l-4 0l0 -4"}],["path",{"d":"M15 9l6 -6"}],["path",{"d":"M19 15l-4 0l0 4"}],["path",{"d":"M15 15l6 6"}]],
  arrowUp: [["path",{"d":"M12 5l0 14"}],["path",{"d":"M18 11l-6 -6"}],["path",{"d":"M6 11l6 -6"}]],
  arrowUpRight: [["path",{"d":"M17 7l-10 10"}],["path",{"d":"M8 7l9 0l0 9"}]],
  "bell": [["path",{"d":"M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"}],["path",{"d":"M9 17v1a3 3 0 0 0 6 0v-1"}]],
  bellRinging: [["path",{"d":"M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"}],["path",{"d":"M9 17v1a3 3 0 0 0 6 0v-1"}],["path",{"d":"M21 6.727a11.05 11.05 0 0 0 -2.794 -3.727"}],["path",{"d":"M3 6.727a11.05 11.05 0 0 1 2.792 -3.727"}]],
  "bolt": [["path",{"d":"M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"}]],
  "book": [["path",{"d":"M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0"}],["path",{"d":"M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0"}],["path",{"d":"M3 6l0 13"}],["path",{"d":"M12 6l0 13"}],["path",{"d":"M21 6l0 13"}]],
  buildingFactory: [["path",{"d":"M4 21c1.147 -4.02 1.983 -8.027 2 -12h6c.017 3.973 .853 7.98 2 12"}],["path",{"d":"M12.5 13h4.5c.025 2.612 .894 5.296 2 8"}],["path",{"d":"M9 5a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1"}],["path",{"d":"M3 21l19 0"}]],
  "bulb": [["path",{"d":"M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7"}],["path",{"d":"M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3"}],["path",{"d":"M9.7 17l4.6 0"}]],
  chartArea: [["path",{"d":"M4 19l16 0"}],["path",{"d":"M4 15l4 -6l4 2l4 -5l4 4l0 5l-16 0"}]],
  chartBar: [["path",{"d":"M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6"}],["path",{"d":"M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10"}],["path",{"d":"M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14"}],["path",{"d":"M4 20h14"}]],
  chartCandle: [["path",{"d":"M4 7a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -3"}],["path",{"d":"M6 4l0 2"}],["path",{"d":"M6 11l0 9"}],["path",{"d":"M10 15a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -3"}],["path",{"d":"M12 4l0 10"}],["path",{"d":"M12 19l0 1"}],["path",{"d":"M16 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -4"}],["path",{"d":"M18 4l0 1"}],["path",{"d":"M18 11l0 9"}]],
  chartDots: [["path",{"d":"M3 3v18h18"}],["path",{"d":"M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"}],["path",{"d":"M17 7a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"}],["path",{"d":"M12 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"}],["path",{"d":"M10.16 10.62l2.34 2.88"}],["path",{"d":"M15.088 13.328l2.837 -4.586"}]],
  chartLine: [["path",{"d":"M4 19l16 0"}],["path",{"d":"M4 15l4 -6l4 2l4 -5l4 4"}]],
  "check": [["path",{"d":"M5 12l5 5l10 -10"}]],
  chevronDown: [["path",{"d":"M6 9l6 6l6 -6"}]],
  chevronLeft: [["path",{"d":"M15 6l-6 6l6 6"}]],
  chevronRight: [["path",{"d":"M9 6l6 6l-6 6"}]],
  chevronUp: [["path",{"d":"M6 15l6 -6l6 6"}]],
  clipboardList: [["path",{"d":"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"}],["path",{"d":"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"}],["path",{"d":"M9 12l.01 0"}],["path",{"d":"M13 12l2 0"}],["path",{"d":"M9 16l.01 0"}],["path",{"d":"M13 16l2 0"}]],
  "copy": [["path",{"d":"M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666"}],["path",{"d":"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"}]],
  currencyDollar: [["path",{"d":"M16.7 8a3 3 0 0 0 -2.7 -2h-4a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6h-4a3 3 0 0 1 -2.7 -2"}],["path",{"d":"M12 3v3m0 12v3"}]],
  "database": [["path",{"d":"M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0"}],["path",{"d":"M4 6v6a8 3 0 0 0 16 0v-6"}],["path",{"d":"M4 12v6a8 3 0 0 0 16 0v-6"}]],
  databaseOff: [["path",{"d":"M12.983 8.978c3.955 -.182 7.017 -1.446 7.017 -2.978c0 -1.657 -3.582 -3 -8 -3c-1.661 0 -3.204 .19 -4.483 .515m-2.783 1.228c-.471 .382 -.734 .808 -.734 1.257c0 1.22 1.944 2.271 4.734 2.74"}],["path",{"d":"M4 6v6c0 1.657 3.582 3 8 3c.986 0 1.93 -.067 2.802 -.19m3.187 -.82c1.251 -.53 2.011 -1.228 2.011 -1.99v-6"}],["path",{"d":"M4 12v6c0 1.657 3.582 3 8 3c3.217 0 5.991 -.712 7.261 -1.74m.739 -3.26v-4"}],["path",{"d":"M3 3l18 18"}]],
  deviceFloppy: [["path",{"d":"M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2"}],["path",{"d":"M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"}],["path",{"d":"M14 4l0 4l-6 0l0 -4"}]],
  "dots": [["path",{"d":"M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}]],
  "download": [["path",{"d":"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"}],["path",{"d":"M7 11l5 5l5 -5"}],["path",{"d":"M12 4l0 12"}]],
  "edit": [["path",{"d":"M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1"}],["path",{"d":"M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415"}],["path",{"d":"M16 5l3 3"}]],
  externalLink: [["path",{"d":"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"}],["path",{"d":"M11 13l9 -9"}],["path",{"d":"M15 4h5v5"}]],
  "eye": [["path",{"d":"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"}],["path",{"d":"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"}]],
  "filter": [["path",{"d":"M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227"}]],
  filterOff: [["path",{"d":"M8 4h12v2.172a2 2 0 0 1 -.586 1.414l-3.914 3.914m-.5 3.5v4l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227"}],["path",{"d":"M3 3l18 18"}]],
  "flask": [["path",{"d":"M9 3l6 0"}],["path",{"d":"M10 9l4 0"}],["path",{"d":"M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"}]],
  folderOpen: [["path",{"d":"M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"}]],
  "history": [["path",{"d":"M12 8l0 4l2 2"}],["path",{"d":"M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"}]],
  infoCircle: [["path",{"d":"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"}],["path",{"d":"M12 9h.01"}],["path",{"d":"M11 12h1v4h1"}]],
  layoutGrid: [["path",{"d":"M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}],["path",{"d":"M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}],["path",{"d":"M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}],["path",{"d":"M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"}]],
  "leaf": [["path",{"d":"M5 21c.5 -4.5 2.5 -8 7 -10"}],["path",{"d":"M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0"}]],
  "logout": [["path",{"d":"M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"}],["path",{"d":"M9 12h12l-3 -3"}],["path",{"d":"M18 15l3 -3"}]],
  menu2: [["path",{"d":"M4 6l16 0"}],["path",{"d":"M4 12l16 0"}],["path",{"d":"M4 18l16 0"}]],
  "message": [["path",{"d":"M8 9h8"}],["path",{"d":"M8 13h6"}],["path",{"d":"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12"}]],
  "minus": [["path",{"d":"M5 12l14 0"}]],
  "moon": [["path",{"d":"M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"}]],
  "news": [["path",{"d":"M16 6h3a1 1 0 0 1 1 1v11a2 2 0 0 1 -4 0v-13a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1v12a3 3 0 0 0 3 3h11"}],["path",{"d":"M8 8l4 0"}],["path",{"d":"M8 12l4 0"}],["path",{"d":"M8 16l4 0"}]],
  playerPause: [["path",{"d":"M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"}],["path",{"d":"M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"}]],
  playerPlay: [["path",{"d":"M7 4v16l13 -8l-13 -8"}]],
  plugConnected: [["path",{"d":"M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5"}],["path",{"d":"M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l1.5 1.5"}],["path",{"d":"M3 21l2.5 -2.5"}],["path",{"d":"M18.5 5.5l2.5 -2.5"}],["path",{"d":"M10 11l-2 2"}],["path",{"d":"M13 14l-2 2"}]],
  plugX: [["path",{"d":"M13.55 17.733a5.806 5.806 0 0 1 -7.356 -4.052a5.81 5.81 0 0 1 1.537 -5.627l2.054 -2.054l7.165 7.165"}],["path",{"d":"M4 20l3.5 -3.5"}],["path",{"d":"M15 4l-3.5 3.5"}],["path",{"d":"M20 9l-3.5 3.5"}],["path",{"d":"M16 16l4 4"}],["path",{"d":"M20 16l-4 4"}]],
  playerStop: [["path",{"d":"M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -10"}]],
  "plus": [["path",{"d":"M12 5l0 14"}],["path",{"d":"M5 12l14 0"}]],
  "refresh": [["path",{"d":"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"}],["path",{"d":"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"}]],
  reportAnalytics: [["path",{"d":"M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"}],["path",{"d":"M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"}],["path",{"d":"M9 17v-5"}],["path",{"d":"M12 17v-1"}],["path",{"d":"M15 17v-3"}]],
  "robot": [["path",{"d":"M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M9 12v9"}],["path",{"d":"M15 12v9"}],["path",{"d":"M5 16l4 -2"}],["path",{"d":"M15 14l4 2"}],["path",{"d":"M9 18h6"}],["path",{"d":"M10 8v.01"}],["path",{"d":"M14 8v.01"}]],
  "rocket": [["path",{"d":"M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3"}],["path",{"d":"M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3"}],["path",{"d":"M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}]],
  "rotate": [["path",{"d":"M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5"}]],
  "search": [["path",{"d":"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"}],["path",{"d":"M21 21l-6 -6"}]],
  "send": [["path",{"d":"M10 14l11 -11"}],["path",{"d":"M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5"}]],
  "settings": [["path",{"d":"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"}],["path",{"d":"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"}]],
  "shield": [["path",{"d":"M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"}]],
  "sparkles": [["path",{"d":"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"}]],
  "sun": [["path",{"d":"M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"}],["path",{"d":"M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"}]],
  "table": [["path",{"d":"M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14"}],["path",{"d":"M3 10h18"}],["path",{"d":"M10 3v18"}]],
  "target": [["path",{"d":"M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0"}],["path",{"d":"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"}]],
  "timeline": [["path",{"d":"M4 16l6 -7l5 5l5 -6"}],["path",{"d":"M14 14a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M9 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M3 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}],["path",{"d":"M19 8a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"}]],
  arrowsRightLeft: [["path",{"d":"M21 7l-18 0"}],["path",{"d":"M18 10l3 -3l-3 -3"}],["path",{"d":"M6 20l-3 -3l3 -3"}],["path",{"d":"M3 17l18 0"}]],
  "trash": [["path",{"d":"M4 7l16 0"}],["path",{"d":"M10 11l0 6"}],["path",{"d":"M14 11l0 6"}],["path",{"d":"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"}],["path",{"d":"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"}]],
  trendingDown: [["path",{"d":"M3 7l6 6l4 -4l8 8"}],["path",{"d":"M21 10l0 7l-7 0"}]],
  trendingUp: [["path",{"d":"M3 17l6 -6l4 4l8 -8"}],["path",{"d":"M14 7l7 0l0 7"}]],
  "user": [["path",{"d":"M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"}],["path",{"d":"M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"}]],
  "wall": [["path",{"d":"M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12"}],["path",{"d":"M4 8h16"}],["path",{"d":"M20 12h-16"}],["path",{"d":"M4 16h16"}],["path",{"d":"M9 4v4"}],["path",{"d":"M14 8v4"}],["path",{"d":"M8 12v4"}],["path",{"d":"M16 12v4"}],["path",{"d":"M11 16v4"}]],
  "x": [["path",{"d":"M18 6l-12 12"}],["path",{"d":"M6 6l12 12"}]],
};

export const IconActivity = (props: IconProps) => <Icon name="activity" {...props} />;
export const IconAdjustments = (props: IconProps) => <Icon name="adjustments" {...props} />;
export const IconAlertCircle = (props: IconProps) => <Icon name="alert-circle" {...props} />;
export const IconAlertTriangle = (props: IconProps) => <Icon name="alert-triangle" {...props} />;
export const IconArchive = (props: IconProps) => <Icon name="archive" {...props} />;
export const IconArrowDown = (props: IconProps) => <Icon name="arrow-down" {...props} />;
export const IconArrowLeft = (props: IconProps) => <Icon name="arrow-left" {...props} />;
export const IconArrowsMaximize = (props: IconProps) => <Icon name="arrows-maximize" {...props} />;
export const IconArrowsMinimize = (props: IconProps) => <Icon name="arrows-minimize" {...props} />;
export const IconArrowUp = (props: IconProps) => <Icon name="arrow-up" {...props} />;
export const IconArrowUpRight = (props: IconProps) => <Icon name="arrow-up-right" {...props} />;
export const IconBell = (props: IconProps) => <Icon name="bell" {...props} />;
export const IconBellRinging = (props: IconProps) => <Icon name="bell-ringing" {...props} />;
export const IconBolt = (props: IconProps) => <Icon name="bolt" {...props} />;
export const IconBookOpen = (props: IconProps) => <Icon name="book" {...props} />;
export const IconBuildingFactory = (props: IconProps) => <Icon name="building-factory" {...props} />;
export const IconBulb = (props: IconProps) => <Icon name="bulb" {...props} />;
export const IconChartArea = (props: IconProps) => <Icon name="chart-area" {...props} />;
export const IconChartBar = (props: IconProps) => <Icon name="chart-bar" {...props} />;
export const IconChartCandle = (props: IconProps) => <Icon name="chart-candle" {...props} />;
export const IconChartDots = (props: IconProps) => <Icon name="chart-dots" {...props} />;
export const IconChartLine = (props: IconProps) => <Icon name="chart-line" {...props} />;
export const IconCheck = (props: IconProps) => <Icon name="check" {...props} />;
export const IconChevronDown = (props: IconProps) => <Icon name="chevron-down" {...props} />;
export const IconChevronLeft = (props: IconProps) => <Icon name="chevron-left" {...props} />;
export const IconChevronRight = (props: IconProps) => <Icon name="chevron-right" {...props} />;
export const IconChevronUp = (props: IconProps) => <Icon name="chevron-up" {...props} />;
export const IconClipboardList = (props: IconProps) => <Icon name="clipboard-list" {...props} />;
export const IconCopy = (props: IconProps) => <Icon name="copy" {...props} />;
export const IconCurrencyDollar = (props: IconProps) => <Icon name="currency-dollar" {...props} />;
export const IconDatabase = (props: IconProps) => <Icon name="database" {...props} />;
export const IconDatabaseOff = (props: IconProps) => <Icon name="database-off" {...props} />;
export const IconDeviceFloppy = (props: IconProps) => <Icon name="device-floppy" {...props} />;
export const IconDots = (props: IconProps) => <Icon name="dots" {...props} />;
export const IconDownload = (props: IconProps) => <Icon name="download" {...props} />;
export const IconEdit = (props: IconProps) => <Icon name="edit" {...props} />;
export const IconExternalLink = (props: IconProps) => <Icon name="external-link" {...props} />;
export const IconEye = (props: IconProps) => <Icon name="eye" {...props} />;
export const IconFilter = (props: IconProps) => <Icon name="filter" {...props} />;
export const IconFilterOff = (props: IconProps) => <Icon name="filter-off" {...props} />;
export const IconFlask = (props: IconProps) => <Icon name="flask" {...props} />;
export const IconFolderOpen = (props: IconProps) => <Icon name="folder-open" {...props} />;
export const IconHistory = (props: IconProps) => <Icon name="history" {...props} />;
export const IconInfoCircle = (props: IconProps) => <Icon name="info-circle" {...props} />;
export const IconLayoutGrid = (props: IconProps) => <Icon name="layout-grid" {...props} />;
export const IconLeaf = (props: IconProps) => <Icon name="leaf" {...props} />;
export const IconLogout = (props: IconProps) => <Icon name="logout" {...props} />;
export const IconMenu2 = (props: IconProps) => <Icon name="menu-2" {...props} />;
export const IconMessage = (props: IconProps) => <Icon name="message" {...props} />;
export const IconMinus = (props: IconProps) => <Icon name="minus" {...props} />;
export const IconMoon = (props: IconProps) => <Icon name="moon" {...props} />;
export const IconNews = (props: IconProps) => <Icon name="news" {...props} />;
export const IconPlayerPause = (props: IconProps) => <Icon name="player-pause" {...props} />;
export const IconPlayerPlay = (props: IconProps) => <Icon name="player-play" {...props} />;
export const IconPlayerStop = (props: IconProps) => <Icon name="player-stop" {...props} />;
export const IconPlus = (props: IconProps) => <Icon name="plus" {...props} />;
export const IconRefresh = (props: IconProps) => <Icon name="refresh" {...props} />;
export const IconReportAnalytics = (props: IconProps) => <Icon name="report-analytics" {...props} />;
export const IconRobot = (props: IconProps) => <Icon name="robot" {...props} />;
export const IconRocket = (props: IconProps) => <Icon name="rocket" {...props} />;
export const IconRotate = (props: IconProps) => <Icon name="rotate" {...props} />;
export const IconSearch = (props: IconProps) => <Icon name="search" {...props} />;
export const IconSend = (props: IconProps) => <Icon name="send" {...props} />;
export const IconSettings = (props: IconProps) => <Icon name="settings" {...props} />;
export const IconShield = (props: IconProps) => <Icon name="shield" {...props} />;
export const IconSparkles = (props: IconProps) => <Icon name="sparkles" {...props} />;
export const IconSun = (props: IconProps) => <Icon name="sun" {...props} />;
export const IconTable = (props: IconProps) => <Icon name="table" {...props} />;
export const IconTarget = (props: IconProps) => <Icon name="target" {...props} />;
export const IconTimeline = (props: IconProps) => <Icon name="timeline" {...props} />;
export const IconTrade = (props: IconProps) => <Icon name="arrows-right-left" {...props} />;
export const IconTrash = (props: IconProps) => <Icon name="trash" {...props} />;
export const IconTrendingDown = (props: IconProps) => <Icon name="trending-down" {...props} />;
export const IconTrendingUp = (props: IconProps) => <Icon name="trending-up" {...props} />;
export const IconUser = (props: IconProps) => <Icon name="user" {...props} />;
export const IconWall = (props: IconProps) => <Icon name="wall" {...props} />;
export const IconX = (props: IconProps) => <Icon name="x" {...props} />;
