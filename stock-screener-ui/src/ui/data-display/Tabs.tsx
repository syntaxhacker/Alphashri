import * as React from "react";
import MuiTabs from "@mui/material/Tabs";
import MuiTab from "@mui/material/Tab";
import Box from "@mui/material/Box";
import type { UITabsProps, UITabProps, UITabsPanelProps } from "../types";

type TabsContextValue = {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs compound components must be used within Tabs");
  return ctx;
}

export function Tabs({
  value,
  defaultValue,
  onChange,
  variant,
  color,
  orientation,
  activateOnFocus,
  loop,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITabsProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<string | null | undefined>(defaultValue ?? null);
  const activeValue = isControlled ? value : internal;

  const handleChange = React.useCallback(
    (v: string | null) => {
      if (!isControlled) setInternal(v);
      onChange?.(v);
    },
    [isControlled, onChange]
  );

  // map variant to styling - pills -> pill style via sx, others default
  const sxVariant: any = {};
  if (variant === "pills") {
    sxVariant["& .MuiTabs-indicator"] = { display: "none" };
  }

  const ctxValue: TabsContextValue = { value: activeValue as any, onChange: handleChange };

  return (
    <TabsContext.Provider value={ctxValue}>
      <Box
        className={className}
        style={style}
        data-testid={testId}
        sx={{
          display: orientation === "vertical" ? "flex" : "block",
          flexDirection: orientation === "vertical" ? "row" : undefined,
          ...sxVariant,
        }}
        {...(rest as any)}
      >
        {children}
      </Box>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITabsProps) {
  const { value, onChange } = useTabsContext();
  const handleMuiChange = (_: any, newVal: string) => {
    onChange(newVal);
  };

  return (
    <Box className={className} style={style} data-testid={testId} {...(rest as any)}>
      <MuiTabs value={value ?? false} onChange={handleMuiChange} sx={{ minHeight: 36 }}>
        {children}
      </MuiTabs>
    </Box>
  );
}

export function Tab({
  value: tabValue,
  icon,
  rightSection,
  disabled,
  children,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UITabProps) {
  return (
    <MuiTab
      value={tabValue}
      label={
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          {icon}
          <span>{children}</span>
          {rightSection}
        </Box>
      }
      iconPosition="start"
      disabled={!!disabled}
      className={className}
      style={style}
      data-testid={testId}
      sx={{ textTransform: "none", minHeight: 36, fontSize: 13 }}
      {...(rest as any)}
    />
  );
}

export function TabsPanel({ value: panelValue, keepMounted, children, className, style, "data-testid": testId, ...rest }: UITabsPanelProps) {
  const { value } = useTabsContext();
  const isActive = value === panelValue;
  if (!isActive && !keepMounted) return null;
  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      className={className}
      style={style}
      data-testid={testId}
      sx={{ py: 1.5, display: isActive ? "block" : keepMounted ? (isActive ? "block" : "none") : "block" }}
      {...(rest as any)}
    >
      <Box sx={{ display: isActive ? "block" : "none" }}>{children}</Box>
      {!isActive && keepMounted ? <Box sx={{ display: "none" }}>{children}</Box> : null}
    </Box>
  );
}

Tabs.List = TabsList;
Tabs.Tab = Tab;
Tabs.Panel = TabsPanel;
