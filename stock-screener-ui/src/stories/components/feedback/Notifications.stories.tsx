import type { Meta, StoryObj } from "@storybook/html-vite";
import { Button, Notifications, Stack, Text, showError, showNotification, showSuccess } from "@/ui";
import { solidStory } from "@/stories/solidStory";
import { Catalog, Section } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Feedback/Notifications",
  tags: ["autodocs"],
  component: Notifications as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Notifications is the toast host: mount it once and it renders queued toasts in a bottom-right Toaster. Fire them with the real API — showNotification maps color to a toast variant, while showSuccess and showError are fixed-tone helpers. The demo buttons use in-page copy only; no network or clock values.",
      },
    },
  },
  argTypes: {
    children: { control: false, description: "The app tree under the toast host." },
  },
};
export default meta;
type Story = StoryObj;

export const Tones: Story = {
  render: () =>
    solidStory(() => (
      <Notifications>
        <Catalog title="Notifications — tones" note="Click a labelled button to enqueue a toast. Messages and tones are frozen copy; nothing reads the clock or the network.">
          <Section title="showNotification" note="Maps success / error / warning / info / default to the toast variant; toasts stack bottom-right.">
            <Stack gap="sm">
              <Button variant="outline" color="success" onClick={() => showNotification({
                title: "Order accepted",
                message: "The paper order was written to the book.",
                color: "success",
              })}
              >
                showNotification · success
              </Button>
              <Button variant="outline" color="error" onClick={() => showNotification({
                title: "Rejected",
                message: "Margin check failed for the short leg.",
                color: "error",
              })}
              >
                showNotification · error
              </Button>
              <Button variant="outline" color="warning" onClick={() => showNotification({
                title: "Partial fill",
                message: "Only 1 of 2 legs was filled.",
                color: "warning",
              })}
              >
                showNotification · warning
              </Button>
              <Button variant="outline" color="info" onClick={() => showNotification({
                title: "Feed resumed",
                message: "Market data stream reconnected.",
                color: "info",
              })}
              >
                showNotification · info
              </Button>
              <Button variant="outline" onClick={() => showNotification({
                title: "Notice",
                message: "A neutral notification with no colour.",
              })}
              >
                showNotification · default
              </Button>
            </Stack>
          </Section>
        </Catalog>
      </Notifications>
    )),
};

export const HelpersAndAutoClose: Story = {
  render: () =>
    solidStory(() => (
      <Notifications>
        <Catalog title="Notifications — helpers" note="Fixed-tone helpers and lifetime control, exercised through the same toast host.">
          <Section title="Fixed-tone helpers" note="showSuccess and showError are shortcuts; the message falls back to the title when it is empty.">
            <Stack gap="sm">
              <Button color="success" onClick={() => showSuccess("Order accepted", "The paper order was written to the book.")}>
                showSuccess
              </Button>
              <Button color="error" onClick={() => showError("Feed unavailable", "The options chain returned 503.")}>
                showError
              </Button>
            </Stack>
          </Section>
          <Section title="Auto-close control" note="autoClose accepts a duration in ms or false to keep the toast until dismissed.">
            <Stack gap="sm">
              <Button variant="outline" color="info" onClick={() => showNotification({
                title: "Long-lived",
                message: "This toast stays until you dismiss it (autoClose=false).",
                color: "info",
                autoClose: false,
              })}
              >
                autoClose = false
              </Button>
              <Button variant="outline" onClick={() => showNotification({
                title: "Short-lived",
                message: "This toast uses a 1500 ms autoClose duration.",
                autoClose: 1500,
              })}
              >
                autoClose = 1500
              </Button>
            </Stack>
            <Text size="xs" c="dimmed" style={{ "padding-top": "16px" }}>Each button has a visible label; the toaster is rendered by the host.</Text>
          </Section>
        </Catalog>
      </Notifications>
    )),
};
