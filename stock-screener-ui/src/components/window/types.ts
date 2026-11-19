export interface WindowState {
  id: string;                 // instance id
  type: string;               // panel type from a registry
  title: string;
  x: number; y: number;       // px within the canvas
  w: number; h: number;
  z: number;
  minimized?: boolean;
  maximized?: boolean;
  /**
   * Panel-owned, JSON-safe settings. Additive: layouts saved before this field
   * existed load unchanged, and a panel that never reads it pays nothing.
   * Unknown/removed panel types simply leave their bag unread.
   */
  settings?: Record<string, unknown>;
}

export interface WindowLayout {
  windows: WindowState[];
  /** Saved named workspaces, e.g. Main / Blank / Macro. */
  name?: string;
}
