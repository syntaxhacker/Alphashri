import type { JSX } from "solid-js";
import {
  AppShellHeader, AppShellMain, AppShellNavbar, Badge, Box, Group, NavLink, Stack, Text, ThemeIcon,
} from "@/ui";
import { IconActivity, IconBolt, IconChartBar, IconTable } from "@/ui/icons";

/** Local specimen chrome — theme variables only, so it follows the active theme. */
export function Page(props: { children: JSX.Element }) {
  return (
    <Stack gap="lg" style={{ width: "100%", "max-width": "880px", "box-sizing": "border-box" }}>
      {props.children}
    </Stack>
  );
}

export function Specimen(props: {
  title: string;
  code?: string;
  note?: string;
  children: JSX.Element;
}) {
  return (
    <Box
      style={{
        border: "1px solid var(--color-fin-border)",
        background: "var(--color-fin-surface)",
        width: "100%",
        "min-width": 0,
        "box-sizing": "border-box",
      }}
    >
      <Stack gap="sm" p="md">
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">
            {props.title}
          </Text>
          {props.code ? (
            <Text size="xs" c="primary" className="font-mono">{props.code}</Text>
          ) : null}
          {props.note ? (
            <Text size="xs" c="dimmed" style={{ "line-height": 1.5 }}>{props.note}</Text>
          ) : null}
        </Stack>
        <Box style={{ width: "24px", height: "2px", background: "var(--color-fin-primary)" }} />
        <Box style={{ "min-width": 0, width: "100%" }}>{props.children}</Box>
      </Stack>
    </Box>
  );
}

/** Single column in a narrow preview, multiple columns on a wide canvas. */
export function SpecimenGrid(props: { children: JSX.Element; min?: number }) {
  return (
    <Box
      style={{
        display: "grid",
        gap: "16px",
        "grid-template-columns": `repeat(auto-fit, minmax(${props.min ?? 280}px, 1fr))`,
        "align-items": "start",
        width: "100%",
      }}
    >
      {props.children}
    </Box>
  );
}

export function Readout(props: { children: JSX.Element }) {
  return (
    <Box
      style={{
        padding: "8px 12px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface-alt)",
        "min-width": 0,
      }}
    >
      <Text size="xs" c="dimmed" className="font-mono" style={{ "line-height": 1.5 }}>
        {props.children}
      </Text>
    </Box>
  );
}

export function SampleRow(props: { label: string; value: string; tone?: string }) {
  return (
    <Group
      gap="sm"
      align="center"
      justify="space-between"
      style={{
        padding: "8px 12px",
        border: "1px solid var(--color-fin-border)",
        "border-radius": "4px",
        background: "var(--color-fin-surface-alt)",
        "min-width": 0,
      }}
    >
      <Text size="xs" fw={600} style={{ color: "var(--color-fin-text)" }}>{props.label}</Text>
      <Text size="xs" className="font-mono" style={{ color: props.tone ?? "var(--color-fin-text-muted)" }}>
        {props.value}
      </Text>
    </Group>
  );
}

function ShellNav() {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} c="dimmed" className="font-mono" style={{ padding: "4px 8px" }}>
        WORKSPACE
      </Text>
      <NavLink
        label="Market"
        description="Breadth and spot"
        active
        icon={<ThemeIcon size="xs" variant="light"><IconActivity size={12} /></ThemeIcon>}
      />
      <NavLink
        label="Screener"
        description="Filters and signals"
        defaultOpened
        icon={<ThemeIcon size="xs" variant="light"><IconTable size={12} /></ThemeIcon>}
      >
        <NavLink label="Saved views" active />
        <NavLink label="Runs" />
      </NavLink>
      <NavLink
        label="Options"
        description="Chain and flow"
        icon={<ThemeIcon size="xs" variant="light"><IconBolt size={12} /></ThemeIcon>}
      />
      <NavLink label="Reports" disabled description="Not in this workspace" />
    </Stack>
  );
}

/** Visible chrome for an AppShell: the primitive's own bars are empty shells. */
export function ShellChrome(props: {
  headerCollapsed?: boolean;
  navbarCollapsed?: boolean;
  width?: number;
  children?: JSX.Element;
}) {
  const width = props.width ?? 220;
  const top = props.headerCollapsed ? 0 : 48;
  return (
    <>
      {!props.headerCollapsed ? (
        <AppShellHeader
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: "48px",
            display: "flex",
            "align-items": "center",
            gap: "12px",
            padding: "0 16px",
            background: "var(--color-fin-surface-alt)",
            "border-bottom": "1px solid var(--color-fin-border)",
          }}
        >
          <Text size="sm" fw={700} c="primary" className="font-mono">ALPHASHRI</Text>
          <Text size="xs" c="dimmed">Paper workspace</Text>
          <Badge size="xs" color="success">session live</Badge>
        </AppShellHeader>
      ) : null}
      {!props.navbarCollapsed ? (
        <AppShellNavbar
          p="xs"
          style={{
            position: "absolute",
            left: 0,
            top: `${top}px`,
            bottom: 0,
            width: `${width}px`,
            background: "var(--color-fin-surface)",
            "border-right": "1px solid var(--color-fin-border)",
            overflow: "auto",
          }}
        >
          <ShellNav />
        </AppShellNavbar>
      ) : null}
      <AppShellMain
        style={{
          position: "absolute",
          top: `${top}px`,
          left: props.navbarCollapsed ? 0 : `${width}px`,
          right: 0,
          bottom: 0,
          padding: "16px",
          overflow: "auto",
          background: "var(--color-fin-surface)",
        }}
      >
        {props.children ?? (
          <Stack gap="sm">
            <Group gap="sm" align="center">
              <ThemeIcon size="sm" variant="light"><IconChartBar size={14} /></ThemeIcon>
              <Text size="sm" fw={700}>Screener · saved view</Text>
            </Group>
            <Text size="xs" c="dimmed">214 symbols scanned · 18 passed the filters.</Text>
            <SampleRow label="Universe" value="NIFTY 500" />
            <SampleRow label="Signals" value="3 fresh" tone="var(--color-fin-primary)" />
            <SampleRow label="Session" value="paper · pinned" tone="var(--color-fin-positive)" />
          </Stack>
        )}
      </AppShellMain>
    </>
  );
}
