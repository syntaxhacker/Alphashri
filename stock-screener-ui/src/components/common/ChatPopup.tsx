import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { Markdown } from "./Markdown";
import {
  ActionIcon,
  Box,
  TextInput,
  Group,
  Text,
  Paper,
  ScrollArea,
  Loader,
  Progress,
  Badge,
  Stack,
  Collapse,
  NavLink,
  Divider,
} from "@/ui";
import { IconMessage, IconSend, IconX, IconRobot, IconUser, IconHistory, IconTrash, IconPlus, IconSearch, IconArrowsMaximize, IconArrowsMinimize } from "./Icons";
import { BLACK } from "../../config/colors";
import {
  checkTradingAgentsHealth,
  streamStockAnalysis,
  sendChatMessage,
  listConversations,
  createConversation,
  getMessages,
  addMessage,
  deleteConversation,
  type Conversation,
} from "../../api/trading_agents";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  analysis?: {
    ticker: string;
    decision: string;
    stats?: unknown;
    reports?: Record<string, string>;
  };
}

interface AgentProgress {
  agent: string;
  status: "pending" | "running" | "completed";
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


export function ChatPopup() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [input, setInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [isAvailable, setIsAvailable] = createSignal<boolean | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [agentProgress, setAgentProgress] = createSignal<AgentProgress[]>([]);
  const [conversations, setConversations] = createSignal<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = createSignal<string | null>(null);
  const [showHistory, setShowHistory] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [toolCalls, setToolCalls] = createSignal<
    Array<{ tool: string; agent: string; args?: unknown }>
  >([]);

  let messagesEndRef: HTMLDivElement | undefined;
  let abortController: AbortController | null = null;

  createEffect(() => {
    if (isOpen() && isAvailable() === null) {
      checkTradingAgentsHealth()
        .then((health) => {
          setIsAvailable(health.tradingagents_available);
          if (health.tradingagents_available) void loadConversations();
        })
        .catch(() => setIsAvailable(false));
    }
  });

  createEffect(() => {
    // Track message appends so the conversation auto-scrolls to the bottom.
    messages();
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  });

  onCleanup(() => {
    abortController?.abort();
  });

  const loadConversations = async () => {
    try {
      const convos = await listConversations();
      setConversations(convos);
    } catch {}
  };

  const switchConversation = async (convoId: string) => {
    setActiveConvo(convoId);
    setShowHistory(false);
    try {
      const msgs = await getMessages(convoId);
      setMessages(
        msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
        })),
      );
    } catch {}
  };

  const startNewConversation = async () => {
    try {
      const convo = await createConversation();
      setActiveConvo(convo.id);
      setMessages([]);
      setConversations((prev) => [convo, ...prev]);
    } catch {}
  };

  const handleDeleteConversation = async (convoId: string, e: MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(convoId);
      setConversations((prev) => prev.filter((c) => c.id !== convoId));
      if (activeConvo() === convoId) {
        setActiveConvo(null);
        setMessages([]);
      }
    } catch {}
  };

  const addLocalMessage = (
    role: "user" | "assistant",
    content: string,
    analysis?: Message["analysis"],
  ) => {
    const newMessage: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      role,
      content,
      timestamp: new Date(),
      analysis,
    };
    setMessages((prev) => [...prev, newMessage]);
    return newMessage;
  };

  const saveMessage = async (role: string, content: string, tickerVal?: string) => {
    let convoId = activeConvo();
    if (!convoId) {
      const convo = await createConversation();
      convoId = convo.id;
      setActiveConvo(convoId);
      setConversations((prev) => [convo, ...prev]);
    }
    await addMessage(convoId, role, content, tickerVal);
  };

  const handleSend = async () => {
    if (!input().trim() || isLoading()) return;

    const userMessage = input().trim();
    setInput("");

    addLocalMessage("user", userMessage);
    try {
      await saveMessage("user", userMessage);
    } catch {}

    setIsLoading(true);

    try {
      const resp = await sendChatMessage({ message: userMessage });

      if (resp.should_analyze) {
        const extractedTicker = resp.should_analyze;
        setProgress(0);
        setToolCalls([]);
        setAgentProgress([
          { agent: "Market Analyst", status: "pending" },
          { agent: "News Analyst", status: "pending" },
          { agent: "Fundamentals", status: "pending" },
          { agent: "Research Team", status: "pending" },
          { agent: "Trading Team", status: "pending" },
          { agent: "Risk Management", status: "pending" },
          { agent: "Portfolio Manager", status: "pending" },
        ]);
        addLocalMessage("assistant", resp.response);

        abortController = new AbortController();
        const generator = streamStockAnalysis(extractedTicker, {
          analysts: ["market", "news", "fundamentals"],
          llm_provider: "deepseek",
        });

        for await (const event of generator) {
          if (event.event === "tool_call") {
            const data = event.data as { tool?: string; agent?: string; args?: unknown };
            setToolCalls((prev) => [
              ...prev,
              { tool: data.tool || "", agent: data.agent || "", args: data.args },
            ]);
          } else if (event.event === "progress") {
            const data = event.data as { percent: number; step?: number };
            setProgress(data.percent);
          } else if (event.event === "complete") {
            setProgress(100);
            const data = event.data as {
              decision?: string;
              reports?: Record<string, string>;
              stats?: unknown;
            };
            const fullDecision = data.decision || "HOLD";
            const signal =
              (fullDecision.match(/\*\*Recommendation:\s*(\w+)\*\*/) ||
                fullDecision.match(/\b(BUY|SELL|HOLD)\b/))?.[1] || "HOLD";
            const content = `📊 **${extractedTicker} Analysis**\n\n${fullDecision}`;
            const msg = addLocalMessage("assistant", content, {
              ticker: extractedTicker,
              decision: signal,
              stats: data.stats,
              reports: data.reports,
            });
            try {
              await saveMessage("assistant", msg.content, extractedTicker);
            } catch {}
          } else if (event.event === "error") {
            const data = event.data as { error?: string };
            console.error("Stream error:", data.error);
            addLocalMessage("assistant", `❌ Error: ${data.error || "Unknown error"}`);
          }
        }
        setIsLoading(false);
      } else {
        const msg = addLocalMessage("assistant", resp.response);
        try {
          await saveMessage("assistant", msg.content);
        } catch {}
        setIsLoading(false);
      }
    } catch {
      const msg = addLocalMessage(
        "assistant",
        `Sorry, I couldn't process that. Try asking about a specific stock like "What do you think about NVDA?"`,
      );
      try {
        await saveMessage("assistant", msg.content);
      } catch {}
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const toggleChat = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <>
      <ActionIcon
        size={56}
        radius="xl"
        variant="filled"
        color="primary"
        onClick={toggleChat}
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          "z-index": 1000,
          "box-shadow": `0 4px 12px ${withAlpha(BLACK, 0.15)}`,
        }}
        data-testid="chat-popup-toggle"
      >
        {isOpen() ? <IconX size={24} /> : <IconMessage size={24} />}
      </ActionIcon>

      <Collapse in={isOpen()}>
        <Paper
          shadow="lg"
          style={{
            position: "fixed",
            bottom: expanded() ? "10px" : "90px",
            right: expanded() ? "10px" : "20px",
            width: expanded() ? "calc(100vw - 280px)" : "400px",
            "max-width": expanded() ? "900px" : "400px",
            height: expanded() ? "calc(100vh - 20px)" : "520px",
            "z-index": 1000,
            display: "flex",
            "flex-direction": "column",
            transition: "all 0.2s ease",
            resize: expanded() ? "none" : "both",
            overflow: "auto",
            "min-width": "320px",
            "min-height": "400px",
          }}
          data-testid="chat-popup-window"
        >
          <Box p="sm" className="bg-fin-primary/12">
            <Group justify="space-between">
              <Group gap="xs">
                <IconRobot size={20} />
                <Text fw={600} size="sm">
                  Trading Assistant
                </Text>
              </Group>
              <Group gap={4}>
                <Show when={isAvailable()}>
                  <ActionIcon variant="subtle" size="sm" onClick={() => setExpanded((p) => !p)} data-testid="chat-expand-btn">
                    <Show when={expanded()} fallback={<IconArrowsMaximize size={16} />}>
                      <IconArrowsMinimize size={16} />
                    </Show>
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    data-testid="chat-history-btn"
                    onClick={() => {
                      setShowHistory((p) => !p);
                      void loadConversations();
                    }}
                  >
                    <IconHistory size={16} />
                  </ActionIcon>
                </Show>
                <Show when={isAvailable() === false}>
                  <Badge size="xs" color="error">
                    Unavailable
                  </Badge>
                </Show>
              </Group>
            </Group>
          </Box>

          <Collapse in={showHistory()}>
            <Box className="max-h-[180px] overflow-y-auto">
              <Group p="xs" justify="space-between">
                <Text size="xs" fw={600}>
                  Conversations
                </Text>
                <ActionIcon variant="subtle" size="sm" onClick={startNewConversation} data-testid="chat-new-convo-btn">
                  <IconPlus size={14} />
                </ActionIcon>
              </Group>
              <Show when={conversations().length === 0}>
                <Text size="xs" c="dimmed" ta="center" py="sm">
                  No saved conversations
                </Text>
              </Show>
              <Show when={conversations().length > 0}>
                <For each={conversations()}>{(c) => (
                  <NavLink
                    label={
                      <Group justify="space-between">
                        <Text size="xs" lineClamp={1}>
                          {c.title}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          size="xs"
                          color="error"
                          onClick={(e) => handleDeleteConversation(c.id, e)}
                          data-testid={`chat-delete-convo-${c.id}`}
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Group>
                    }
                    active={activeConvo() === c.id}
                    onClick={() => void switchConversation(c.id)}
                    style={{ padding: "4px 8px" }}
                  />
                )}</For>
              </Show>
              <Divider />
            </Box>
          </Collapse>

          <Show when={isLoading()}>
            <Box px="sm" pt="xs">
              <Group gap="xs" mb={4}>
                <Text size="xs" c="dimmed">
                  Analyzing...
                </Text>
                <Text size="xs" fw={600}>
                  {progress()}%
                </Text>
              </Group>
              <Progress value={progress()} size="sm" animated />
              <Stack gap={2} mt={4}>
                <For each={agentProgress()}>{(agent) => (
                  <Group gap={4}>
                    <Box
                      className={`h-2 w-2 rounded-full ${
                        agent.status === "completed"
                          ? "bg-fin-positive"
                          : agent.status === "running"
                            ? "bg-fin-primary"
                            : "bg-fin-text-muted"
                      }`}
                    />
                    <Text size="xs" c="dimmed">
                      {agent.agent}
                    </Text>
                  </Group>
                )}</For>
              </Stack>
              <Show when={toolCalls().length > 0}>
                <Box mt={4}>
                  <Text size="xs" fw={600} c="dimmed" mb={2}>
                    Tool Calls
                  </Text>
                  <ScrollArea style={{ "max-height": "100px" }}>
                    <Stack gap={2}>
                      <For each={toolCalls()}>{(tc) => (
                        <Group gap={4}>
                          <IconSearch size={10} />
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {tc.tool}
                          </Text>
                          <Text size="xs" c="secondary" className="opacity-50">
                            {tc.agent}
                          </Text>
                        </Group>
                      )}</For>
                    </Stack>
                  </ScrollArea>
                </Box>
              </Show>
            </Box>
          </Show>

          <ScrollArea style={{ flex: 1 }} p="sm">
            <Show when={messages().length > 0} fallback={(
              <Stack gap={4} align="center" py="xl">
                <Text size="sm" c="dimmed" ta="center" component="div">
                  Ask me to analyze a stock!
                </Text>
                <Text size="xs" c="dimmed" ta="center" component="div">
                  Try: &quot;Analyze NVDA&quot; or &quot;NVDA report&quot;
                </Text>
              </Stack>
            )}>
              <Stack gap="sm">
                <For each={messages()}>{(msg) => (
                  <Box
                    style={{
                      display: "flex",
                      "justify-content": msg.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <Paper
                      p="xs"
                      radius="md"
                      className={msg.role === "user" ? "max-w-[85%] bg-fin-primary/12" : "max-w-[85%]"}
                    >
                      <Group gap={4} mb={4}>
                        <Show when={msg.role === "user"} fallback={<IconRobot size={14} />}>
                          <IconUser size={14} />
                        </Show>
                        <Text size="xs" c="dimmed">
                          {msg.role === "user" ? "You" : "Assistant"}
                        </Text>
                      </Group>
                      <Markdown content={msg.content} />
                      <Show when={msg.analysis}>
                        {(analysis) => (
                        <Stack gap={4} mt="xs">
                          <Group gap={4}>
                            <Badge size="xs" color="primary">
                              {analysis().ticker}
                            </Badge>
                            <Badge
                              size="xs"
                              color={
                                analysis().decision === "BUY"
                                  ? "success"
                                  : analysis().decision === "SELL"
                                    ? "error"
                                    : "warning"
                              }
                            >
                              {analysis().decision}
                            </Badge>
                          </Group>
                          <Show when={analysis().reports && Object.keys(analysis().reports!).length > 0}>
                            <Stack gap={2}>
                              <For each={Object.entries(analysis().reports ?? {})}>{([section, content]) => (
                                <Paper
                                  p={4}
                                  className="bg-fin-surface"
                                >
                                  <Text size="xs" fw={600} tt="capitalize">
                                    {section.replace(/_/g, " ")}
                                  </Text>
                                  <ScrollArea style={{ "max-height": "200px" }} type="hover">
                                    <Markdown content={String(content)} />
                                  </ScrollArea>
                                </Paper>
                              )}</For>
                            </Stack>
                          </Show>
                        </Stack>
                        )}
                      </Show>
                    </Paper>
                  </Box>
                )}</For>
                <Show when={isLoading()}>
                  <Group gap="xs" p="xs">
                    <Loader size="xs" />
                    <Text size="xs" c="dimmed">
                      Processing...
                    </Text>
                  </Group>
                </Show>
                <div ref={(el) => (messagesEndRef = el)} />
              </Stack>
            </Show>
          </ScrollArea>

          <Box p="sm">
            <Group gap="xs">
              <TextInput
                size="sm"
                placeholder={isLoading() ? "Analyzing..." : "Type a message..."}
                value={input()}
                onChange={(value) => setInput(value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading() || isAvailable() === false}
                style={{ flex: 1 }}
                data-testid="chat-input"
              />
              <ActionIcon
                size="sm"
                variant="filled"
                color="primary"
                onClick={handleSend}
                disabled={!input().trim() || isLoading() || isAvailable() === false}
                data-testid="chat-send-button"
              >
                <IconSend size={16} />
              </ActionIcon>
            </Group>
          </Box>
        </Paper>
      </Collapse>
    </>
  );
}
