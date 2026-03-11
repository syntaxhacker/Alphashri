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
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Options can be complex. Here is a simple guide to help you understand the data and make
          better decisions.
        </Text>

        <Divider label="The Basics" labelPosition="center" />

        <Group grow gap="xs">
          <Paper p="xs" withBorder radius="sm">
            <Text fw={700} size="xs" c="green.7">
              CALLS (CE)
            </Text>
            <Text size="xs">
              Right to buy. Traders buy CE if they expect the price to **GO UP**.
            </Text>
          </Paper>
          <Paper p="xs" withBorder radius="sm">
            <Text fw={700} size="xs" c="red.7">
              PUTS (PE)
            </Text>
            <Text size="xs">
              Right to sell. Traders buy PE if they expect the price to **GO DOWN**.
            </Text>
          </Paper>
        </Group>

        <Divider label="Key Indicators" labelPosition="center" />

        <List
          spacing="xs"
          size="sm"
          icon={
            <ThemeIcon color="blue" size={20} radius="xl">
              <IconInfoCircle size={12} />
            </ThemeIcon>
          }
        >
          <List.Item>
            <Text component="span" fw={700}>
              PCR (Put-Call Ratio):
            </Text>{" "}
            If {">"} 1.2, more puts are being sold (Bullish). If {"<"} 0.7, more calls are being
            sold (Bearish).
          </List.Item>
          <List.Item>
            <Text component="span" fw={700}>
              Max Pain:
            </Text>{" "}
            The price level where option buyers lose the most money. Market often tends to gravitate
            towards this level on expiry.
          </List.Item>
          <List.Item>
            <Text component="span" fw={700}>
              Open Interest (OI):
            </Text>{" "}
            The total number of open contracts. High OI acts as a "Wall" (Support or Resistance).
          </List.Item>
        </List>

        <Divider label="Sentiment Badges (What are they doing?)" labelPosition="center" />

        <Stack gap={5}>
          <Group gap="xs">
            <Badge color="green" variant="light" w={80}>
              LB
            </Badge>
            <Text size="xs" fw={700}>
              Long Buildup:
            </Text>
            <Text size="xs">New buyers entering. **Strong Bullish signal.**</Text>
          </Group>
          <Group gap="xs">
            <Badge color="red" variant="light" w={80}>
              SB
            </Badge>
            <Text size="xs" fw={700}>
              Short Buildup:
            </Text>
            <Text size="xs">Sellers creating new positions. **Strong Bearish signal.**</Text>
          </Group>
          <Group gap="xs">
            <Badge color="cyan" variant="light" w={80}>
              SC
            </Badge>
            <Text size="xs" fw={700}>
              Short Covering:
            </Text>
            <Text size="xs">Sellers closing positions. **Price usually bounces up.**</Text>
          </Group>
          <Group gap="xs">
            <Badge color="orange" variant="light" w={80}>
              LU
            </Badge>
            <Text size="xs" fw={700}>
              Long Unwinding:
            </Text>
            <Text size="xs">Buyers closing positions. **Price usually profit books (down).**</Text>
          </Group>
        </Stack>

        <Paper
          p="sm"
          bg="blue.0"
          radius="md"
          style={{ border: "1px solid var(--mantine-color-blue-2)" }}
        >
          <Group gap="xs" wrap="nowrap">
            <IconTarget size={20} color="var(--mantine-color-blue-6)" />
            <Text size="xs" fw={600} c="blue.9">
              PRO TIP: Look for strikes where both OI and Volume are spiking with an "LB"
              badge—that's where the next big move might happen!
            </Text>
          </Group>
        </Paper>
      </Stack>
    </Modal>
  );
}
