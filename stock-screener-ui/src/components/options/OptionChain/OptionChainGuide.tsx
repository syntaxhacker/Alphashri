import {
  Modal,
  Text,
  Stack,
  Group,
  Badge,
  List,
  ThemeIcon,
  Title,
  Divider,
  Paper,
} from "@mantine/core";
import {
  IconInfoCircle,
  IconTrendingUp,
  IconTrendingDown,
  IconTarget,
  IconActivity,
} from "@tabler/icons-react";

interface OptionChainGuideProps {
  opened: boolean;
  onClose: () => void;
}

export function OptionChainGuide({ opened, onClose }: OptionChainGuideProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="How to Read the Option Chain"
      size="lg"
      centered
      radius="md"
      className="option-chain-guide-modal"
      data-testid="options-chain-guide-modal"
    >
      <Stack gap="sm" className="guide-content" data-testid="options-guide-content">
        <Text size="sm" c="dimmed" className="guide-intro">
          Options can be complex. Here is a simple guide to help you understand the data and make
          better decisions.
        </Text>

        <Divider label="The Basics" labelPosition="center" className="guide-divider" />

        <Group grow gap="xs" className="guide-basics" data-testid="options-guide-basics">
          <Paper p="xs" withBorder radius="sm" className="guide-card guide-card-calls">
            <Text fw={700} size="sm" c="green.7">
              CALLS (CE)
            </Text>
            <Text size="sm">
              Right to buy. Traders buy CE if they expect the price to **GO UP**.
            </Text>
          </Paper>
          <Paper p="xs" withBorder radius="sm" className="guide-card guide-card-puts">
            <Text fw={700} size="sm" c="red.7">
              PUTS (PE)
            </Text>
            <Text size="sm">
              Right to sell. Traders buy PE if they expect the price to **GO DOWN**.
            </Text>
          </Paper>
        </Group>

        <Divider label="Key Indicators" labelPosition="center" className="guide-divider" />

        <List
          spacing="xs"
          size="sm"
          className="guide-indicators"
          data-testid="options-guide-indicators"
          icon={
            <ThemeIcon color="blue" size={20} radius="xl">
              <IconInfoCircle size={12} />
            </ThemeIcon>
          }
        >
          <List.Item className="guide-indicator-item" data-testid="options-guide-pcr">
            <Text component="span" fw={700}>
              PCR (Put-Call Ratio):
            </Text>{" "}
            If {">"} 1.2, more puts are being sold (Bullish). If {"<"} 0.7, more calls are being
            sold (Bearish).
          </List.Item>
          <List.Item className="guide-indicator-item" data-testid="options-guide-max-pain">
            <Text component="span" fw={700}>
              Max Pain:
            </Text>{" "}
            The price level where option buyers lose the most money. Market often tends to gravitate
            towards this level on expiry.
          </List.Item>
          <List.Item className="guide-indicator-item" data-testid="options-guide-oi">
            <Text component="span" fw={700}>
              Open Interest (OI):
            </Text>{" "}
            The total number of open contracts. High OI acts as a "Wall" (Support or Resistance).
          </List.Item>
        </List>

        <Divider
          label="Sentiment Badges (What are they doing?)"
          labelPosition="center"
          className="guide-divider"
        />

        <Stack gap={5} className="guide-badges" data-testid="options-guide-badges">
          <Group gap="xs" className="guide-badge-row" data-testid="options-guide-badge-lb">
            <Badge color="green" variant="light" w={80}>
              LB
            </Badge>
            <Text size="sm" fw={700}>
              Long Buildup:
            </Text>
            <Text size="sm">New buyers entering. **Strong Bullish signal.**</Text>
          </Group>
          <Group gap="xs" className="guide-badge-row" data-testid="options-guide-badge-sb">
            <Badge color="red" variant="light" w={80}>
              SB
            </Badge>
            <Text size="sm" fw={700}>
              Short Buildup:
            </Text>
            <Text size="sm">Sellers creating new positions. **Strong Bearish signal.**</Text>
          </Group>
          <Group gap="xs" className="guide-badge-row" data-testid="options-guide-badge-sc">
            <Badge color="cyan" variant="light" w={80}>
              SC
            </Badge>
            <Text size="sm" fw={700}>
              Short Covering:
            </Text>
            <Text size="sm">Sellers closing positions. **Price usually bounces up.**</Text>
          </Group>
          <Group gap="xs" className="guide-badge-row" data-testid="options-guide-badge-lu">
            <Badge color="orange" variant="light" w={80}>
              LU
            </Badge>
            <Text size="sm" fw={700}>
              Long Unwinding:
            </Text>
            <Text size="sm">Buyers closing positions. **Price usually profit books (down).**</Text>
          </Group>
        </Stack>

        <Paper
          p="sm"
          bg="blue.0"
          radius="md"
          className="guide-pro-tip"
          style={{ border: "1px solid var(--mantine-color-blue-2)" }}
          data-testid="options-guide-pro-tip"
        >
          <Group gap="xs" wrap="nowrap">
            <IconTarget size={20} color="var(--mantine-color-blue-6)" />
            <Text size="sm" fw={600} c="blue.9">
              PRO TIP: Look for strikes where both OI and Volume are spiking with an "LB"
              badge—that's where the next big move might happen!
            </Text>
          </Group>
        </Paper>
      </Stack>
    </Modal>
  );
}
