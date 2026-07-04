import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Tooltip,
  ThemeIcon,
  Code as MantineCode,
  Timeline,
  Title,
  Anchor,
} from "@/ui";
import {
  IconMessage,
  IconSend,
  IconX,
  IconRobot,
  IconUser,
  IconHistory,
  IconTrash,
  IconPlus,
  IconChartBar,
  IconNews,
  IconCoin,
  IconTrendingUp,
  IconSearch,
  IconDatabase,
  IconChartLine,
  IconArrowsMaximize,
  IconArrowsMinimize,
} from "@tabler/icons-react";
import {
  checkTradingAgentsHealth,
  streamStockAnalysis,
  sendChatMessage,
  listConversations,
  createConversation,
  getMessages,
  addMessage,
  deleteConversation,
  type AnalysisRequest,
  type Conversation,
  type ChatMessage,
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

const mdComponents = {
  h1: ({ children }: any) => (
    <Title order={1} size="lg" mt="xs" mb={2}>
      {children}
    </Title>
  ),
  h2: ({ children }: any) => (
    <Title order={2} size="md" mt="xs" mb={2}>
      {children}
    </Title>
  ),
  h3: ({ children }: any) => (
    <Title order={3} size="sm" mt="xs" mb={2}>
      {children}
    </Title>
  ),
  p: ({ children }: any) => (
    <Text size="sm" mb={2} style={{ lineHeight: 1.5 }}>
      {children}
    </Text>
  ),
  code: ({ children }: any) => <MantineCode style={{ fontSize: 11 }}>{children}</MantineCode>,
  a: ({ href, children }: any) => (
    <Anchor href={href} size="sm">
      {children}
    </Anchor>
  ),
  ul: ({ children }: any) => (
    <Box component="ul" ml="md" mb={2}>
      {children}
    </Box>
  ),
  ol: ({ children }: any) => (
    <Box component="ol" ml="md" mb={2}>
      {children}
    </Box>
  ),
  li: ({ children }: any) => (
    <Text component="li" size="sm" mb={1}>
      {children}
    </Text>
  ),
  strong: ({ children }: any) => (
    <Text component="strong" fw={700}>
      {children}
    </Text>
  ),
  table: ({ children }: any) => (
    <Box
      component="table"
      style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 4 }}
    >
      {children}
    </Box>
  ),
  th: ({ children }: any) => (
    <Box
      component="th"
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        padding: 2,
        fontWeight: 600,
      }}
    >
      {children}
    </Box>
  ),
  td: ({ children }: any) => (
    <Box
      component="td"
      style={{ border: "1px solid var(--mantine-color-default-border)", padding: 2 }}
    >
      {children}
    </Box>
  ),
};

export function ChatPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [progress, setProgress] = useState(0);
  const [agentProgress, setAgentProgress] = useState<AgentProgress[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toolCalls, setToolCalls] = useState<
    Array<{ tool: string; agent: string; args?: unknown }>
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen && isAvailable === null) {
      checkTradingAgentsHealth()
        .then((health) => {
          setIsAvailable(health.tradingagents_available);
          if (health.tradingagents_available) loadConversations();
        })
        .catch(() => setIsAvailable(false));
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleDeleteConversation = async (convoId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(convoId);
      setConversations((prev) => prev.filter((c) => c.id !== convoId));
      if (activeConvo === convoId) {
        setActiveConvo(null);
        setMessages([]);
      }
    } catch {}
  };

  const addLocalMessage = useCallback(
    (role: "user" | "assistant", content: string, analysis?: Message["analysis"]) => {
      const newMessage: Message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        role,
        content,
        timestamp: new Date(),
        analysis,
      };
      setMessages((prev) => [...prev, newMessage]);
      return newMessage;
    },
    [],
  );

  const saveMessage = async (role: string, content: string, tickerVal?: string) => {
    let convoId = activeConvo;
    if (!convoId) {
      const convo = await createConversation();
      convoId = convo.id;
      setActiveConvo(convoId);
      setConversations((prev) => [convo, ...prev]);
    }
    await addMessage(convoId, role, content, tickerVal);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
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

        abortControllerRef.current = new AbortController();
        console.log("Starting stream for", extractedTicker);
        const generator = streamStockAnalysis(extractedTicker, {
          analysts: ["market", "news", "fundamentals"],
          llm_provider: "deepseek",
        });

        let eventCount = 0;
        for await (const event of generator) {
          eventCount++;
          if (eventCount === 1) console.log("First event received:", event.event);
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
        console.log(`Stream ended after ${eventCount} events`);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
        color="blue"
        onClick={toggleChat}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 1000,
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        }}
        data-testid="chat-popup-toggle"
      >
        {isOpen ? <IconX size={24} /> : <IconMessage size={24} />}
      </ActionIcon>

      <Collapse in={isOpen}>
        <Paper
          shadow="lg"
          style={{
            position: "fixed",
            bottom: expanded ? 10 : 90,
            right: expanded ? 10 : 20,
            width: expanded ? "calc(100vw - 280px)" : 400,
            maxWidth: expanded ? 900 : 400,
            height: expanded ? "calc(100vh - 20px)" : 520,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            transition: "all 0.2s ease",
            resize: expanded ? "none" : "both",
            overflow: "auto",
            minWidth: 320,
            minHeight: 400,
          }}
          data-testid="chat-popup-window"
        >
          <Box
            p="sm"
            style={{
              borderBottom: "1px solid var(--mantine-color-default-border)",
              backgroundColor: "var(--mantine-color-blue-light)",
            }}
          >
            <Group justify="space-between">
              <Group gap="xs">
                <IconRobot size={20} />
                <Text fw={600} size="sm">
                  Trading Assistant
                </Text>
              </Group>
              <Group gap={4}>
                {isAvailable && (
                  <>
                    <ActionIcon variant="subtle" size="sm" onClick={() => setExpanded((p) => !p)} data-testid="chat-expand-btn">
                      {expanded ? (
                        <IconArrowsMinimize size={16} />
                      ) : (
                        <IconArrowsMaximize size={16} />
                      )}
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      data-testid="chat-history-btn"
                      onClick={() => {
                        setShowHistory((p) => !p);
                        loadConversations();
                      }}
                    >
                      <IconHistory size={16} />
                    </ActionIcon>
                  </>
                )}
                {isAvailable === false && (
                  <Badge size="xs" color="red">
                    Unavailable
                  </Badge>
                )}
              </Group>
            </Group>
          </Box>

          <Collapse in={showHistory}>
            <Box
              style={{
                maxHeight: 180,
                overflowY: "auto",
                borderBottom: "1px solid var(--mantine-color-default-border)",
              }}
            >
              <Group p="xs" justify="space-between">
                <Text size="xs" fw={600}>
                  Conversations
                </Text>
                <ActionIcon variant="subtle" size="sm" onClick={startNewConversation} data-testid="chat-new-convo-btn">
                  <IconPlus size={14} />
                </ActionIcon>
              </Group>
              {conversations.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" py="sm">
                  No saved conversations
                </Text>
              ) : (
                conversations.map((c) => (
                  <NavLink
                    key={c.id}
                    label={
                      <Group justify="space-between">
                        <Text size="xs" lineClamp={1}>
                          {c.title}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          size="xs"
                          color="red"
                          onClick={(e) => handleDeleteConversation(c.id, e)}
                          data-testid={`chat-delete-convo-${c.id}`}
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Group>
                    }
                    active={activeConvo === c.id}
                    onClick={() => switchConversation(c.id)}
                    styles={{ root: { padding: "4px 8px" }, label: { fontSize: 12 } }}
                  />
                ))
              )}
              <Divider />
            </Box>
          </Collapse>

          {isLoading && (
            <Box px="sm" pt="xs">
              <Group gap="xs" mb={4}>
                <Text size="xs" c="dimmed">
                  Analyzing...
                </Text>
                <Text size="xs" fw={600}>
                  {progress}%
                </Text>
              </Group>
              <Progress value={progress} size="sm" animated />
              <Stack gap={2} mt={4}>
                {agentProgress.map((agent) => (
                  <Group key={agent.agent} gap={4}>
                    <Box
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor:
                          agent.status === "completed"
                            ? "var(--mantine-color-green-6)"
                            : agent.status === "running"
                              ? "var(--mantine-color-blue-6)"
                              : "var(--mantine-color-gray-5)",
                      }}
                    />
                    <Text size="xs" c="dimmed">
                      {agent.agent}
                    </Text>
                  </Group>
                ))}
              </Stack>
              {toolCalls.length > 0 && (
                <Box mt={4}>
                  <Text size="xs" fw={600} c="dimmed" mb={2}>
                    Tool Calls
                  </Text>
                  <ScrollArea style={{ maxHeight: 100 }}>
                    <Stack gap={2}>
                      {toolCalls.map((tc, i) => (
                        <Group key={i} gap={4}>
                          <IconSearch size={10} />
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {tc.tool}
                          </Text>
                          <Text size="xs" c="gray" style={{ opacity: 0.5 }}>
                            {tc.agent}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  </ScrollArea>
                </Box>
              )}
            </Box>
          )}

          <ScrollArea style={{ flex: 1 }} p="sm">
            {messages.length === 0 ? (
              <Stack gap={4} align="center" py="xl">
                <Text size="sm" c="dimmed" ta="center" component="div">
                  Ask me to analyze a stock!
                </Text>
                <Text size="xs" c="dimmed" ta="center" component="div">
                  Try: &quot;Analyze NVDA&quot; or &quot;NVDA report&quot;
                </Text>
              </Stack>
            ) : (
              <Stack gap="sm">
                {messages.map((msg) => (
                  <Box
                    key={msg.id}
                    style={{
                      display: "flex",
                      justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <Paper
                      p="xs"
                      radius="md"
                      bg={
                        msg.role === "user"
                          ? "var(--mantine-color-blue-light)"
                          : "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-6))"
                      }
                      style={{ maxWidth: "85%" }}
                    >
                      <Group gap={4} mb={4}>
                        {msg.role === "user" ? <IconUser size={14} /> : <IconRobot size={14} />}
                        <Text size="xs" c="dimmed">
                          {msg.role === "user" ? "You" : "Assistant"}
                        </Text>
                      </Group>
                      <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                      {msg.analysis && (
                        <Stack gap={4} mt="xs">
                          <Group gap={4}>
                            <Badge size="xs" color="blue">
                              {msg.analysis.ticker}
                            </Badge>
                            <Badge
                              size="xs"
                              color={
                                msg.analysis.decision === "BUY"
                                  ? "green"
                                  : msg.analysis.decision === "SELL"
                                    ? "red"
                                    : "yellow"
                              }
                            >
                              {msg.analysis.decision}
                            </Badge>
                          </Group>
                          {msg.analysis.reports && Object.keys(msg.analysis.reports).length > 0 && (
                            <Stack gap={2}>
                              {Object.entries(msg.analysis.reports).map(([section, content]) => (
                                <Paper
                                  key={section}
                                  p={4}
                                  style={{
                                    background:
                                      "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))",
                                  }}
                                >
                                  <Text size="xs" fw={600} tt="capitalize">
                                    {section.replace(/_/g, " ")}
                                  </Text>
                                  <ScrollArea style={{ maxHeight: 200 }} type="hover">
                                    <ReactMarkdown
                                      components={mdComponents}
                                      remarkPlugins={[remarkGfm]}
                                    >
                                      {String(content)}
                                    </ReactMarkdown>
                                  </ScrollArea>
                                </Paper>
                              ))}
                            </Stack>
                          )}
                        </Stack>
                      )}
                    </Paper>
                  </Box>
                ))}
                {isLoading && (
                  <Group gap="xs" p="xs">
                    <Loader size="xs" />
                    <Text size="xs" c="dimmed">
                      Processing...
                    </Text>
                  </Group>
                )}
                <div ref={messagesEndRef} />
              </Stack>
            )}
          </ScrollArea>

          <Box p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Group gap="xs">
              <TextInput
                placeholder={isLoading ? "Analyzing..." : "Type a message..."}
                value={input}
                onChange={(value) => setInput(value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || isAvailable === false}
                style={{ flex: 1 }}
                data-testid="chat-input"
              />
              <ActionIcon
                variant="filled"
                color="blue"
                onClick={handleSend}
                disabled={!input.trim() || isLoading || isAvailable === false}
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
