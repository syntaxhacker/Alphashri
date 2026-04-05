import {
  Alert,
  Anchor,
  Badge,
  Card,
  CloseButton,
  Collapse,
  Divider,
  Group,
  List,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  ActionIcon,
  Loader,
  Title,
} from "@mantine/core";
import {
  IconChartLine,
  IconExternalLink,
  IconInfoCircle,
  IconTarget,
  IconTrendingUp,
  IconChevronDown,
  IconChevronRight,
  IconNews,
} from "@tabler/icons-react";
import type { NewsItem, NewsSymbol, ArticleResponse } from "./news-types";
import { SOURCE_COLORS } from "./news-constants";
import { formatTimeAgo } from "../../utils/ui-helpers";
import { SentimentBadge } from "./SentimentBadge";
import { ImpactScore } from "./ImpactScore";
import { TradeIdeaCard } from "./TradeIdeaCard";

interface ArticleDetailProps {
  selectedArticle: NewsItem | null;
  articleContent: ArticleResponse | null;
  articleLoading: boolean;
  isMobile: boolean;
  showFullContent: boolean;
  onClose: () => void;
  onToggleFullContent: () => void;
  onSymbolClick: (symbol: NewsSymbol) => void;
}

export function ArticleDetail({
  selectedArticle,
  articleContent,
  articleLoading,
  isMobile,
  showFullContent,
  onClose,
  onToggleFullContent,
  onSymbolClick,
}: ArticleDetailProps) {
  const hasLlmSummary = !!(
    articleContent?.summary ||
    (articleContent?.key_points && articleContent.key_points.length > 0)
  );

  return (
    <Stack gap="sm" data-testid="article-detail" className="article-detail">
      {selectedArticle ? (
        <>
          <Group justify="space-between">
            <Title order={4} data-testid="article-title" lineClamp={2}>
              {selectedArticle.headline}
            </Title>
            {isMobile && <CloseButton onClick={onClose} data-testid="close-article-btn" />}
          </Group>

          <Group gap="sm">
            <Badge color={SOURCE_COLORS[selectedArticle.source] || "gray"} variant="light">
              {selectedArticle.source}
            </Badge>
            <Text size="sm" c="dimmed">
              {formatTimeAgo(articleContent?.publishedAt || selectedArticle.publishedAt)}
            </Text>
          </Group>

          {articleLoading ? (
            <Group justify="center" py="xl">
              <Loader size="sm" />
              <Text c="dimmed">Analyzing article...</Text>
            </Group>
          ) : (
            <>
              {articleContent?.sentiment && (
                <Group gap="sm">
                  <SentimentBadge sentiment={articleContent.sentiment} />
                  <ImpactScore score={articleContent.impact_score} />
                </Group>
              )}

              {articleContent?.summary && (
                <Alert
                  icon={<IconInfoCircle size={16} />}
                  title="Summary"
                  color="blue"
                  variant="light"
                >
                  <Text size="sm">{articleContent.summary}</Text>
                </Alert>
              )}

              {articleContent?.key_points && articleContent.key_points.length > 0 && (
                <Stack gap="sm">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="green">
                      <IconTarget size={14} />
                    </ThemeIcon>
                    <Text size="sm" fw={600}>
                      Key Takeaways
                    </Text>
                  </Group>
                  <List size="sm" withPadding ml="md">
                    {articleContent.key_points.map((point, idx) => (
                      <List.Item key={idx}>
                        <Text size="sm">{point}</Text>
                      </List.Item>
                    ))}
                  </List>
                </Stack>
              )}

              {articleContent?.symbols && articleContent.symbols.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={500}>
                    Stocks mentioned:
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    {articleContent.symbols.map((symbol, idx) => (
                      <Tooltip
                        key={idx}
                        label={
                          symbol.instrument_key
                            ? `View ${symbol.trading_symbol} chart`
                            : `View details`
                        }
                        position="top"
                      >
                        <Badge
                          variant="light"
                          color={symbol.instrument_key ? "blue" : "gray"}
                          size="sm"
                          radius="sm"
                          style={{ cursor: "pointer" }}
                          onClick={() => onSymbolClick(symbol)}
                          rightSection={
                            symbol.instrument_key ? (
                              <IconChartLine size={12} style={{ marginLeft: 4 }} />
                            ) : undefined
                          }
                          data-testid="symbol-badge"
                        >
                          {symbol.name || symbol.code}
                        </Badge>
                      </Tooltip>
                    ))}
                  </Group>
                </Stack>
              )}

              {articleContent?.trade_ideas && articleContent.trade_ideas.length > 0 && (
                <Stack gap="sm">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="orange">
                      <IconTrendingUp size={14} />
                    </ThemeIcon>
                    <Text size="sm" fw={600}>
                      Trade Ideas
                    </Text>
                  </Group>
                  <Stack gap="xs">
                    {articleContent.trade_ideas.map((idea, idx) => (
                      <TradeIdeaCard key={idx} idea={idea} />
                    ))}
                  </Stack>
                </Stack>
              )}

              {articleContent?.description && (
                <>
                  <Divider />
                  {hasLlmSummary ? (
                    <Stack gap="xs">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={onToggleFullContent}
                        style={{ alignSelf: "flex-start" }}
                      >
                        {showFullContent ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronRight size={16} />
                        )}
                      </ActionIcon>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ cursor: "pointer", marginTop: -28, marginLeft: 28 }}
                        onClick={onToggleFullContent}
                      >
                        {showFullContent ? "Hide full article" : "View full article"}
                      </Text>
                      <Collapse in={showFullContent}>
                        <Stack gap="sm" mt="xs">
                          {articleContent.description.split("\n\n").map((para, idx) => (
                            <Text key={idx} size="sm">
                              {para}
                            </Text>
                          ))}
                        </Stack>
                      </Collapse>
                    </Stack>
                  ) : (
                    <Stack gap="sm">
                      {articleContent.description.split("\n\n").map((para, idx) => (
                        <Text key={idx} size="sm">
                          {para}
                        </Text>
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </>
          )}

          {selectedArticle.sourceUrl && (
            <Anchor
              href={selectedArticle.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
            >
              <Group gap={4}>
                Open Original <IconExternalLink size={14} />
              </Group>
            </Anchor>
          )}
        </>
      ) : (
        <Stack align="center" justify="center" h="100%" py="xl">
          <IconNews size={48} stroke={1} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed" ta="center">
            Select an article from the list to view details
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
