export interface WindowState {
  id: string;                 // instance id
  type: string;               // panel type from a registry
  title: string;
  x: number; y: number;       // px within the canvas
  w: number; h: number;
  z: number;
  minimized?: boolean;
  maximized?: boolean;
}

export interface WindowLayout {
  windows: WindowState[];
  /** Saved named workspaces, e.g. Main / Blank / Macro. */
  name?: string;
}
