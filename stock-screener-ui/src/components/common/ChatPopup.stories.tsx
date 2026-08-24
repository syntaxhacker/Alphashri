import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Code, Stack, Text, Title } from "@/ui";
import { ChatPopup } from "./ChatPopup";
import { expect, within, userEvent, waitFor } from "storybook/test";

const meta: Meta<typeof ChatPopup> = {
  title: "Composites/Overlays/ChatPopup",
  component: ChatPopup,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof ChatPopup>;

export const Default: Story = {
  render: () => (
    <Box style={{ height: 560, position: "relative" }}>
      <ChatPopup />
      <Box p="md">
        <Text size="sm" c="dimmed">
          Collapsed FAB (bottom-right). Click to open the chat window.
        </Text>
      </Box>
    </Box>
  ),
};

export const Expanded: Story = {
  render: () => (
    <Box style={{ height: 560, position: "relative" }}>
      <ChatPopup />
    </Box>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByTestId("chat-popup-toggle");
    await userEvent.click(btn);
    await waitFor(() => expect(canvas.getByTestId("chat-popup-window")).toBeInTheDocument());
  },
};

export const WithHistory: Story = {
  render: () => (
    <Stack gap="xs" p="md" style={{ height: 560 }}>
      <Title order={5}>WithHistory — mocked conversations</Title>
      <Text size="xs" c="dimmed">
        Conversations would appear in the history drawer (clock icon). Mocked via
        <Code style={{ fontSize: 11 }}> listConversations → getMessages</Code>.
      </Text>
      <Box style={{ flex: 1, position: "relative", borderRadius: 8 }}>
        <ChatPopup />
        <Stack gap={4} p="sm">
          <Text size="xs" fw={600}>Mock history (not wired to API in Storybook):</Text>
          <Text size="xs">• RELIANCE — BUY — 2026-04-10</Text>
          <Text size="xs">• TCS — HOLD — 2026-04-09</Text>
          <Text size="xs">• INFY — SELL — 2026-04-08</Text>
        </Stack>
      </Box>
      <Code style={{ fontSize: 11 }}>{`import { ChatPopup } from "./ChatPopup";\n<ChatPopup /> // app singleton, no props`}</Code>
    </Stack>
  ),
};

export const Streaming: Story = {
  render: () => (
    <Stack gap="xs" p="md" style={{ height: 560 }}>
      <Title order={5}>Streaming — SSE analysis</Title>
      <Text size="xs" c="dimmed">
        When chat detects a ticker (e.g. “Analyze RELIANCE”), <Code style={{ fontSize: 11 }}>streamStockAnalysis</Code> streams
        <Code style={{ fontSize: 11 }}> progress / tool_call / complete</Code> events. Rendered via react-markdown.
      </Text>
      <Box style={{ flex: 1, position: "relative", borderRadius: 8 }}>
        <ChatPopup />
        <Box p="sm">
          <Text size="xs">Send “Analyze RELIANCE” to trigger streaming (mocked in docs).</Text>
        </Box>
      </Box>
    </Stack>
  ),
};
