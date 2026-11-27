import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, onMount, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Box, Button, Group, Portal, Stack, Text,
} from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

const meta: Meta = {
  title: "Design System/Portal",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for the single teleport primitive: Portal renders children into document.body or an explicit host without changing the React-style source tree it was declared in. Its dedicated component page lives under Design System/Components/Layout/Portal; this page shows the two target modes and a mount toggle.",
      },
    },
  },
};
export default meta;
type Story = StoryObj;

const components: FamilyComponentRef[] = [
  { id: "design-system-components-layout-portal--docs", name: "Portal", note: "Teleport to document.body or a named host" },
];

const Landed = (props: { text: string }) => (
  <Box p="sm" style={{ background: palette.SURFACE_ALT, border: `1px solid ${palette.PRIMARY}` }}>
    <Text size="xs">{props.text}</Text>
  </Box>
);

const TargetSpecimen = () => {
  const [mounted, setMounted] = createSignal(false);
  let elementHost: HTMLDivElement | undefined;
  onMount(() => setMounted(true));
  return (
    <Stack gap="sm" style={{ "max-width": "820px" }}>
      <Text size="xs" c="dimmed">Portals are declared in the source box; their children land in the two hosts on the right.</Text>
      <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
        <Box p="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Text size="sm" fw={600}>Source tree</Text>
          <Text size="xs" c="dimmed">Two Portal components are declared here.</Text>
          <Show when={mounted()}>
            <Portal target="#story-portal-selector-host"><Landed text="Arrived via CSS selector target" /></Portal>
            <Portal target={elementHost}><Landed text="Arrived via element target" /></Portal>
          </Show>
        </Box>
        <Stack gap="sm">
          <div
            id="story-portal-selector-host"
            style={{ "min-height": "56px", padding: "8px", border: `1px dashed ${palette.BORDER}`, background: palette.SURFACE }}
          >
            <Text size="xs" c="dimmed" fw={600}>Host · CSS selector</Text>
          </div>
          <div
            ref={(el) => (elementHost = el)}
            style={{ "min-height": "56px", padding: "8px", border: `1px dashed ${palette.BORDER}`, background: palette.SURFACE }}
          >
            <Text size="xs" c="dimmed" fw={600}>Host · element reference</Text>
          </div>
        </Stack>
      </div>
    </Stack>
  );
};

const DefaultTargetSpecimen = () => (
  <Stack gap="sm" style={{ "max-width": "720px" }}>
    <Box p="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
      <Text size="sm" fw={600}>Declared inside this box</Text>
      <Text size="xs" c="dimmed">
        With no target, Portal appends children to document.body. The teleported node is not a descendant of this box.
      </Text>
    </Box>
    <Portal>
      <Landed text="Teleported to document.body, outside the story tree" />
    </Portal>
  </Stack>
);

const ToggleTargetSpecimen = () => {
  const [mounted, setMounted] = createSignal(false);
  const [active, setActive] = createSignal(true);
  let host: HTMLDivElement | undefined;
  onMount(() => setMounted(true));
  return (
    <Stack gap="sm" style={{ "max-width": "720px" }}>
      <Group gap="sm" align="center" wrap="wrap">
        <Button size="xs" onClick={() => setActive((v) => !v)}>
          {active() ? "Unmount portal content" : "Mount portal content"}
        </Button>
        <Text size="xs" c="dimmed">Unmount removes only the teleported node.</Text>
      </Group>
      <div
        ref={(el) => (host = el)}
        style={{ "min-height": "88px", padding: "12px", border: `1px dashed ${palette.BORDER}`, background: palette.SURFACE }}
      >
        <Text size="xs" c="dimmed" fw={600}>Visible host container</Text>
        <Show when={mounted() && active()}>
          <Portal target={host}>
            <Box style={{ "margin-top": "8px" }}>
              <Landed text="Mounted on demand into the visible host" />
            </Box>
          </Portal>
        </Show>
      </div>
    </Stack>
  );
};

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <FamilyPage>
        <FamilyHero
          name="Portal"
          count={components.length}
          caption="source tree to host"
          purpose="A small escape hatch for layered UI: declare content beside its state, then render it into document.body or a named host. Overlay surfaces use it so stacking and clipping stay independent of the source tree."
          specimen={<TargetSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="Default target" note="No target means the document body is the host.">
          <DefaultTargetSpecimen />
        </SpecimenPanel>
        <SpecimenPanel title="Mount toggle" note="Show controls the portal children, not the host element.">
          <ToggleTargetSpecimen />
        </SpecimenPanel>
        <FamilyFooter source="src/ui" pages="src/stories/components/Layout/Portal.stories.tsx" pagesLabel="dedicated page" />
      </FamilyPage>
    )),
};
