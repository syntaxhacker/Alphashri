import type { UITheme } from "@/ui";
import { uiTheme } from "@/ui";

// Chart helpers still type their theme argument as the old Mantine-era shape;
// at runtime they read only the tokens uiTheme actually provides.
export const theme = uiTheme as UITheme & typeof uiTheme;
export const fontWeights = uiTheme.fontWeights;
