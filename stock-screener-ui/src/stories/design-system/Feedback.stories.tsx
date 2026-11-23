import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";
import {
  Alert, Badge, Box, Button, Flex, Group, Indicator, Loader, LoadingOverlay,
  Notifications, Progress, RingProgress, Skeleton, Stack, Text,
  showError, showNotification, showSuccess,
} from "@/ui";
import * as palette from "@/ui/palette";
import { ComponentIndex, FamilyFooter, FamilyHero, FamilyPage, SpecimenPanel, type FamilyComponentRef } from "./FamilyLanding";

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

const components: FamilyComponentRef[] = [
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
      <FamilyPage>
        <FamilyHero
          name="Feedback"
          count={components.length}
          caption="order acknowledgement"
          purpose="A status vocabulary for the desk: badges label state, alerts explain it inline, toasts report background work, and progress, loaders, skeletons and indicators say how far along it is. Tones map to the same semantic colours as the rest of the system."
          specimen={<AcknowledgementSpecimen />}
        />
        <ComponentIndex items={components} />
        <SpecimenPanel title="Notifications" note="Three entry points stack toasts in the bottom-right toaster.">
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
        </SpecimenPanel>
        <SpecimenPanel title="Progress and loaders" note="Determinate bars, spinners and a region-level overlay.">
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
        </SpecimenPanel>
        <SpecimenPanel title="Skeletons and indicators" note="Placeholders hold layout while counts mark unread or live state.">
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
        </SpecimenPanel>
        <FamilyFooter source="src/ui" pages="src/stories/components/Feedback" />
      </FamilyPage>
    )),
};
