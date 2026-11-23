import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal, onMount, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Anchor, Badge, Box, Button, Card, Divider, Flex, Group, Paper, Portal, Stack, Text, Title,
} from "@/ui";
import * as palette from "@/ui/palette";

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

const docsHref = (id: string) => `../?path=/docs/${id}`;
const DocsLink = (props: { id: string; label: string }) => (
  <Anchor href={docsHref(props.id)} target="_top" c="info" size="sm" underline="hover">{props.label}</Anchor>
);

type ComponentRef = { id: string; name: string; note: string };
const components: ComponentRef[] = [
  { id: "design-system-components-layout-portal--docs", name: "Portal", note: "Teleport to document.body or a named host" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component page</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">Overview · source tree to host</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Index</Text>
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open the card to reach the dedicated page.</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <DocsLink id={item.id} label={item.name} />
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

const Specimen = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

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
      <Stack gap="lg" style={{ "max-width": "1120px", margin: "0 auto", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Portal"
          count={components.length}
          purpose="A small escape hatch for layered UI: declare content beside its state, then render it into document.body or a named host. Overlay surfaces use it so stacking and clipping stay independent of the source tree."
          specimen={<TargetSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Default target" note="No target means the document body is the host.">
          <DefaultTargetSpecimen />
        </Specimen>
        <Specimen title="Mount toggle" note="Show controls the portal children, not the host element.">
          <ToggleTargetSpecimen />
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · dedicated page: <code>src/stories/components/Layout/Portal.stories.tsx</code>.</Text>
      </Stack>
    )),
};
