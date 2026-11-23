import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  Alert, Anchor, Badge, Box, Button, Card, Divider, Flex, Group, Indicator, Loader, LoadingOverlay,
  Notifications, Paper, Progress, RingProgress, Skeleton, Stack, Text, Title,
  showError, showNotification, showSuccess,
} from "@/ui";
import * as palette from "@/ui/palette";

const meta: Meta = {
  title: "Design System/Feedback",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Family landing page for status and progress primitives: badges, alerts, toasts, loaders, progress rings, skeletons and indicators. Each component has its own page under Design System/Components/Feedback; this page is an index plus a few composed examples from a frozen order fixture.",
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
  { id: "design-system-components-feedback-alert--docs", name: "Alert", note: "Inline success, warning and error messages" },
  { id: "design-system-components-feedback-badge--docs", name: "Badge", note: "Tone, variant, dot and count treatments" },
  { id: "design-system-components-feedback-indicator--docs", name: "Indicator", note: "Count and status markers on controls" },
  { id: "design-system-components-feedback-loader--docs", name: "Loader", note: "Bar and dot spinners at three sizes" },
  { id: "design-system-components-feedback-loadingoverlay--docs", name: "LoadingOverlay", note: "Block a region while work completes" },
  { id: "design-system-components-feedback-notifications--docs", name: "Notifications", note: "Bottom-right toasts from three entry points" },
  { id: "design-system-components-feedback-progress--docs", name: "Progress", note: "Determinate bars with semantic colours" },
  { id: "design-system-components-feedback-ringprogress--docs", name: "RingProgress", note: "Segmented radial progress with a label" },
  { id: "design-system-components-feedback-skeleton--docs", name: "Skeleton", note: "Shape placeholders for pending content" },
];

const FamilyHero = (props: { name: string; purpose: string; count: number; specimen: JSX.Element }) => (
  <Paper p="lg" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}`, "border-left": `3px solid ${palette.PRIMARY}` }}>
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" c="primary" tt="uppercase" fw={500} className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">{props.count} component pages</Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" c="dimmed" tt="uppercase" fw={500} className="font-mono">Overview · order acknowledgement</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

const ComponentIndex = (props: { items: ComponentRef[] }) => (
  <Stack gap="sm">
    <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Index</Text>
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">Open each card to reach its dedicated page.</Text>
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

const AcknowledgementSpecimen = () => (
  <Stack gap="sm" style={{ "max-width": "720px" }}>
    <Group gap="sm" align="center" wrap="wrap">
      <Badge variant="dot" color="success">LIVE</Badge>
      <Badge variant="outline" color="info">PAPER</Badge>
      <Text size="xs" c="dimmed">Frozen order fixture · 12:03:15 IST</Text>
    </Group>
    <Alert color="success" title="Order accepted">BUY 1 lot NIFTY 23,500 CE was written to the paper book.</Alert>
    <Flex gap="md" align="center" wrap="wrap">
      <Box style={{ "min-width": "260px", flex: 1 }}>
        <Text size="xs" c="dimmed">Margin check · 62%</Text>
        <Progress value={62} />
      </Box>
      <RingProgress
        value={72}
        sections={[{ value: 72, color: "success" }, { value: 28, color: "secondary" }]}
        label={<Text size="xs" fw={700}>72%</Text>}
      />
      <Loader size="sm" color="success" />
    </Flex>
  </Stack>
);

export const FamilyLanding: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="lg" style={{ "max-width": "1120px", margin: "0 auto", padding: "4px 0 24px" }}>
        <FamilyHero
          name="Feedback"
          count={components.length}
          purpose="A status vocabulary for the desk: badges label state, alerts explain it inline, toasts report background work, and progress, loaders, skeletons and indicators say how far along it is. Tones map to the same semantic colours as the rest of the system."
          specimen={<AcknowledgementSpecimen />}
        />
        <ComponentIndex items={components} />
        <Specimen title="Notifications" note="Three entry points stack toasts in the bottom-right toaster.">
          <Notifications>
            <Stack gap="sm">
              <Text size="xs" c="dimmed">showNotification maps the colour option to the matching toast variant.</Text>
              <Group gap="sm" align="center" wrap="wrap">
                <Button color="success" onClick={() => showSuccess("Order accepted", "The paper order was written to the book.")}>showSuccess</Button>
                <Button color="error" onClick={() => showError("Feed unavailable", "The options chain returned 503.")}>showError</Button>
                <Button variant="outline" color="error" onClick={() => showNotification({ title: "Rejected", message: "Margin check failed for the short leg.", color: "error" })}>showNotification · error</Button>
                <Button variant="outline" color="warning" onClick={() => showNotification({ title: "Partial fill", message: "Only 1 of 2 legs was filled.", color: "warning" })}>showNotification · warning</Button>
                <Button variant="outline" color="info" onClick={() => showNotification({ title: "Feed resumed", message: "Market data stream reconnected.", color: "info" })}>showNotification · info</Button>
                <Button variant="outline" onClick={() => showNotification({ title: "Notice", message: "A neutral notification with no colour.", autoClose: 6000 })}>showNotification · default</Button>
              </Group>
            </Stack>
          </Notifications>
        </Specimen>
        <Specimen title="Progress and loaders" note="Determinate bars, spinners and a region-level overlay.">
          <Stack gap="md" style={{ "max-width": "640px" }}>
            <Flex gap="sm" direction="column" style={{ "max-width": "420px" }}>
              <Text size="xs" c="dimmed">Progress · 62%</Text>
              <Progress value={62} />
              <Progress value={38} color="warning" />
              <Progress value={100} color="success" size="sm" />
            </Flex>
            <Group gap="lg" align="center" wrap="wrap">
              <Loader />
              <Loader type="dots" />
              <Loader size="sm" color="success" />
              <RingProgress
                value={72}
                sections={[{ value: 72, color: "success" }, { value: 28, color: "secondary" }]}
                label={<Text size="xs" fw={700}>72%</Text>}
              />
            </Group>
            <Box style={{ position: "relative", height: "96px", border: `1px solid ${palette.BORDER}`, background: palette.SURFACE_ALT }}>
              <Box p="sm"><Text size="sm">Content under a loading overlay.</Text></Box>
              <LoadingOverlay visible />
            </Box>
          </Stack>
        </Specimen>
        <Specimen title="Skeletons and indicators" note="Placeholders hold layout while counts mark unread or live state.">
          <Stack gap="lg">
            <Group gap="md" align="center" wrap="wrap">
              <Skeleton h={18} w={180} />
              <Skeleton h={18} w={90} />
              <Skeleton circle h={40} w={40} />
              <Skeleton h={64} w={200} />
            </Group>
            <Group gap="xl" align="center" wrap="wrap">
              <Indicator label="3" color="error"><Button variant="outline">Alerts</Button></Indicator>
              <Indicator label="LIVE" color="success"><Button variant="outline">Feed</Button></Indicator>
              <Indicator label="9+" color="warning"><Button variant="outline">Queue</Button></Indicator>
            </Group>
          </Stack>
        </Specimen>
        <Text size="xs" c="dimmed">Source: <code>src/ui</code> · per-component pages: <code>src/stories/components/Feedback</code>.</Text>
      </Stack>
    )),
};
