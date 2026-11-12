import type { JSX } from "solid-js";

interface IconProps {
  size?: number | string;
  className?: string;
  "data-testid"?: string;
  color?: string;
}

/**
 * Inline SVG icons replacing @tabler/icons-react (the Solid build has no
 * React DOM, so React icon components cannot mount). Paths are simple,
 * tabler-like geometry; they're decorative only — no test asserts path data.
 */
export function Icon({ name, size = 16, className, "data-testid": testId, color }: IconProps & { name: string }) {
  const d = ICON_PATHS[name];
  return (
    <svg
      data-testid={testId ?? `icon-${name}`}
      class={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d ? <path d={d} /> : null}
    </svg>
  );
}

// Tabler-like geometry for the icons used across the terminal.
const ICON_PATHS: Record<string, string> = {
  Activity: "M16 12A3 3 0 1 0 12 9v0a3 3 0 0 0 3 3zM3.34 12A8.88 8.88 0 0 0 16.6 4c0 1.21-.15 2.39-.42 3.53M20.66 12a8.88 8.88 0 0 1-13.26 4c0-1.21.15-2.39.42-3.53",
  AlertCircle: "M2 12C2 6.47 6.47 2 12 2s10 4.47 10 10-4.47 10-10 10S2 17.53 2 12Z",
  AlertTriangle: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
  ArrowDown: "M12 9V15M19 12L12 19L5 12",
  ArrowUp: "M12 15V9M5 12L12 5L19 12",
  Bolt: "M13 2L6 14H7L11 4H12L13 2ZM7 22H14L10 8H9L7 22Z",
  BookOpen: "M3 12L12 3L21 12L12 21L3 12Z",
  BellRinging: "M10 17V11a3 3 0 0 1 6 0v6a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2v-6M18 8a2 2 0 1 1-4 0V6a2 2 0 0 1 4 0Z",
  ChevronDown: "M6 9L12 15L18 9",
  ChevronRight: "M9 6L15 12L9 18",
  ChevronUp: "M18 15L12 9L6 15",
  ClipboardList: "M8 9V7a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M8 13V11a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M4 17V15a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2",
  Database: "M2 12C2 9.24 4.24 7 7 7s5 2.24 5 5-2.24 5-5 5S2 14.76 2 12ZM20 12C20 9.24 22.24 7 19.24 7S15 9.24 15 12s2.24 5 4.24 5S22 14.76 22 12Z",
  Dots: "M12 11L12 13M19 11L19 13M5 11L5 13",
  Download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10L12 15L17 10",
  DeviceFloppy: "M5 21H19a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v8a2 2 0 0 0 0 0ZM9 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M4 11V9a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2",
  FilterOff: "M22 3H2L10 13L16 7H22ZM2 21H22L14 11L8 17H2Z",
  FolderOpen: "M10 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2ZM2 15H4a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H2Z",
  History: "M12 12a3 3 0 1 0 3-3 3 3 0 0 0-3-3ZM3 15a9 9 0 1 0 9-9 9 9 0 0 0-9 9Z",
  LayoutGrid: "M3 3H7V7H3ZM17 3H21V7H17ZM3 17H7V21H3ZM17 17H21V21H17Z",
  PlayerPlay: "M8 5L19 12L8 19Z",
  PlayerStop: "M8 5H16V19H8Z",
  Refresh: "M1 4V2H4L22 14L19 22V20L7 12M23 20V22H20L2 10L5 2V4L17 10",
  Settings: "M12.06 11.67L16 12.43V16L12.06 15.23L8 14.43V12L12.06 11.67ZM16.94 7.94L19.06 11L16.94 14.06L14.06 16.94L11 19.06L7.94 16.94L10.06 14L7.94 10.94L10.06 7.94L13 5.06L16.94 7.94ZM12 15A3 3 0 1 0 12 9A3 3 0 0 0 12 15Z",
  Sparkles: "M16 9L13.2 13H16V16L13.2 19L16 23L19 23V16L21.8 13H19V9L16.8 5L16 9ZM11 1L8 1V8L5.2 12L8 16V15L11 11L8 7V1Z",
  Table: "M3 3H21V5H3ZM3 10H21V12H3ZM3 17H21V19H3Z",
  Target: "M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  Timeline: "M20 14V8M4 10L12 6M12 6L20 10M4 10V16M12 18L20 14M12 18L4 14M4 14V20M12 18V12",
  Trade: "M20 4H12.4M4 20H11.6M16.4 20L20 16.4M7.6 4L4 7.6",
  Wall: "M13 3V21M21 3V21M5 3V21",
  X: "M18 6L6 18M6 6l12 12",
};

// Named exports so existing import sites only change the module path.
export const IconActivity = (props: IconProps) => <Icon name="Activity" {...props} />;
export const IconAlertCircle = (props: IconProps) => <Icon name="AlertCircle" {...props} />;
export const IconAlertTriangle = (props: IconProps) => <Icon name="AlertTriangle" {...props} />;
export const IconArrowDown = (props: IconProps) => <Icon name="ArrowDown" {...props} />;
export const IconArrowUp = (props: IconProps) => <Icon name="ArrowUp" {...props} />;
export const IconBellRinging = (props: IconProps) => <Icon name="BellRinging" {...props} />;
export const IconBolt = (props: IconProps) => <Icon name="Bolt" {...props} />;
export const IconBookOpen = (props: IconProps) => <Icon name="BookOpen" {...props} />;
export const IconChevronDown = (props: IconProps) => <Icon name="ChevronDown" {...props} />;
export const IconChevronRight = (props: IconProps) => <Icon name="ChevronRight" {...props} />;
export const IconChevronUp = (props: IconProps) => <Icon name="ChevronUp" {...props} />;
export const IconChartDots = (props: IconProps) => <Icon name="Activity" {...props} />;
export const IconClipboardList = (props: IconProps) => <Icon name="ClipboardList" {...props} />;
export const IconDatabase = (props: IconProps) => <Icon name="Database" {...props} />;
export const IconDatabaseOff = (props: IconProps) => <Icon name="Database" {...props} />;
export const IconDeviceFloppy = (props: IconProps) => <Icon name="DeviceFloppy" {...props} />;
export const IconDots = (props: IconProps) => <Icon name="Dots" {...props} />;
export const IconDownload = (props: IconProps) => <Icon name="Download" {...props} />;
export const IconFilterOff = (props: IconProps) => <Icon name="FilterOff" {...props} />;
export const IconFolderOpen = (props: IconProps) => <Icon name="FolderOpen" {...props} />;
export const IconHistory = (props: IconProps) => <Icon name="History" {...props} />;
export const IconLayoutGrid = (props: IconProps) => <Icon name="LayoutGrid" {...props} />;
export const IconPlayerPlay = (props: IconProps) => <Icon name="PlayerPlay" {...props} />;
export const IconPlayerStop = (props: IconProps) => <Icon name="PlayerStop" {...props} />;
export const IconRefresh = (props: IconProps) => <Icon name="Refresh" {...props} />;
export const IconSettings = (props: IconProps) => <Icon name="Settings" {...props} />;
export const IconSparkles = (props: IconProps) => <Icon name="Sparkles" {...props} />;
export const IconTable = (props: IconProps) => <Icon name="Table" {...props} />;
export const IconTarget = (props: IconProps) => <Icon name="Target" {...props} />;
export const IconTimeline = (props: IconProps) => <Icon name="Timeline" {...props} />;
export const IconTrade = (props: IconProps) => <Icon name="Trade" {...props} />;
export const IconWall = (props: IconProps) => <Icon name="Wall" {...props} />;
export const IconX = (props: IconProps) => <Icon name="X" {...props} />;
