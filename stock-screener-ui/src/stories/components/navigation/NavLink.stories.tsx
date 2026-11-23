import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, NavLink, Stack, Text, ThemeIcon } from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Navigation/NavLink",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: NavLink as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "NavLink renders an `<a role=link>` when `href` is set, otherwise a `<div role=link>`. `active` applies the primary fill and aria-current=page; `disabled` applies aria-disabled and pointer-events:none. `icon` (or `leftSection`) and `description` surround the `label`. With `children`, the link toggles an inline collapse: uncontrolled via `defaultOpened`, controlled via `opened`. Keyboard honesty: the div variant has no tabIndex or key handler, and children are toggled by click only — there is no built-in Enter/Space activation.",
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "Primary link text." },
    description: { control: "text", description: "Secondary muted line under the label." },
    href: { control: "text", description: "When set, renders an anchor instead of a div." },
    active: { control: "boolean", description: "Primary fill + aria-current=page." },
    disabled: { control: "boolean", description: "aria-disabled + pointer-events:none." },
    icon: { control: false, description: "Leading icon element (JSX)." },
    leftSection: { control: false, description: "Alias for icon when icon is absent." },
    rightSection: { control: false, description: "Trailing element, e.g. a badge." },
    defaultOpened: { control: "boolean", description: "Initial collapse state (uncontrolled)." },
    opened: { control: "boolean", description: "Controlled collapse state." },
    onClick: { action: "onClick", description: "Fires on click for both link and div variants." },
  },
};
export default meta;
type Story = StoryObj;

function NavIcon(props: { children: string }) {
  return <ThemeIcon size="xs" variant="light">{props.children}</ThemeIcon>;
}

const groupStyle = {
  width: "100%",
  "max-width": "640px",
  background: "var(--color-fin-surface)",
  border: "1px solid var(--color-fin-border)",
  "border-radius": "4px",
} as const;

export const OpenGroup: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Open navigation group"
          code="defaultOpened · active"
          note="Frozen open state: nested children are on screen and the current page is marked active."
        >
          <Box style={groupStyle}>
            <NavLink
              label="Screener"
              description="Filters and saved views"
              active
              icon={<NavIcon>S</NavIcon>}
              defaultOpened
            >
              <NavLink label="Saved views" description="3 views" active />
              <NavLink label="Run history" description="Last run pinned" />
            </NavLink>
            <NavLink label="Options" description="Chain and flow" icon={<NavIcon>O</NavIcon>}>
              <NavLink label="Chain" />
              <NavLink label="Flow" />
            </NavLink>
          </Box>
        </Specimen>
      </Page>
    )),
};

export const States: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen
          title="States"
          note="Default, active, disabled, icon+description and the anchor variant. Disabled links stay aria-disabled and non-interactive."
        >
          <Box
            onClickCapture={(e: MouseEvent) => e.preventDefault()}
            style={groupStyle}
          >
            <NavLink label="Default" description="Hover for the surface tint" />
            <NavLink label="Active page" description="Primary fill + aria-current" active icon={<NavIcon>A</NavIcon>} />
            <NavLink label="Disabled" description="pointer-events: none" disabled icon={<NavIcon>D</NavIcon>} />
            <NavLink label="Icon + description" description="Chain, paper, replay" icon={<NavIcon>O</NavIcon>} />
            <NavLink label="Anchor variant" href="#navlink-anchor" description="Renders an <a> element" rightSection={<Text size="xs" c="dimmed">↗</Text>} />
          </Box>
        </Specimen>
      </Page>
    )),
};

export const CollapsibleChildren: Story = {
  render: () =>
    solidStory(() => {
      const [controlled, setControlled] = createSignal(true);
      const [clicks, setClicks] = createSignal(0);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="Uncontrolled" code="defaultOpened" note="The component owns the collapse signal and toggles on click.">
              <Box style={groupStyle}>
                <NavLink label="Workspace · defaultOpened" description="Opens on first render" defaultOpened icon={<NavIcon>U</NavIcon>}>
                  <NavLink label="Nested · screener" />
                  <NavLink label="Nested · breadth" />
                </NavLink>
                <NavLink label="Collapsed group" icon={<NavIcon>C</NavIcon>}>
                  <NavLink label="Nested · reports" />
                </NavLink>
              </Box>
            </Specimen>
            <Specimen title="Controlled" code="opened · onClick" note="The parent signal owns `opened`, so clicking only reports onClick.">
              <Stack gap="sm">
                <Button size="xs" variant="outline" onClick={() => setControlled((v) => !v)}>
                  opened: {String(controlled())}
                </Button>
                <Readout>onClick count: {clicks()}</Readout>
                <Box style={groupStyle}>
                  <NavLink
                    label="Workspace · controlled"
                    description="Parent owns the state"
                    opened={controlled()}
                    icon={<NavIcon>C</NavIcon>}
                    onClick={() => setClicks((c) => c + 1)}
                  >
                    <NavLink label="Nested · chain" />
                    <NavLink label="Nested · replay" />
                  </NavLink>
                </Box>
              </Stack>
            </Specimen>
          </SpecimenGrid>
        </Page>
      );
    }),
};

export const Playground: Story = {
  args: {
    label: "Workspace",
    description: "Chain and replay",
    active: false,
    disabled: false,
    defaultOpened: true,
  },
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Playground"
          code={`active=${String(args.active)} · disabled=${String(args.disabled)} · defaultOpened=${String(args.defaultOpened)}`}
        >
          <Stack gap="sm">
            <SampleRow label="Label" value={String(args.label ?? "Link")} />
            <Box style={groupStyle}>
              <NavLink
                label={String(args.label ?? "Link")}
                description={String(args.description ?? "")}
                active={Boolean(args.active)}
                disabled={Boolean(args.disabled)}
                defaultOpened={Boolean(args.defaultOpened)}
                icon={<NavIcon>W</NavIcon>}
              >
                <NavLink label="Nested item" />
              </NavLink>
            </Box>
          </Stack>
        </Specimen>
      </Page>
    )),
};
