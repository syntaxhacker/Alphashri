import {
  Group,
  Text,
  Stack,
  Badge,
  Loader,
  Alert,
  Tabs,
  Button,
  Tooltip as MantineTooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconAlertCircle,
  IconTable,
  IconChartBar,
  IconHelpCircle,
  IconClock,
} from "@tabler/icons-react";
import { useDisclosure } from "@mantine/hooks";
import dayjs from "dayjs";
import { OptionChainHeader } from "./OptionChainHeader";
import { OptionChainFilters } from "./OptionChainFilters";
import { OptionChainTable } from "./OptionChainTable";
import { ChainSummary } from "./ChainSummary";
import { OIAnalysis } from "./OIAnalysis";
import { OptionChainGuide } from "./OptionChainGuide";
import { LiveSpotChart } from "./LiveSpotChart";

interface OptionChainPanelProps {
  selectedUnderlying: string;
  selectedExpiry: string;
  loading: boolean;
  error: string | null;
  filters: any;
  spotPrice: number | null;
  setUnderlying: (u: string) => void;
  setExpiry: (e: string) => void;
  setFilters: (f: any) => void;
  refreshChain: () => void;
  availableUnderlyings: string[];
  availableExpiries: string[];
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  timestamp?: string;
  summary?: any;
}

export function OptionChainPanel({
  selectedUnderlying,
  selectedExpiry,
  loading,
  error,
  filters,
  spotPrice,
  setUnderlying,
  setExpiry,
  setFilters,
  refreshChain,
  availableUnderlyings,
  availableExpiries,
  strikeMatrix,
  timestamp,
  summary,
}: OptionChainPanelProps) {
  const [guideOpened, { open, close }] = useDisclosure(false);

  return (
    <Stack gap="md" style={{ height: "100%" }} data-testid="options-chain-panel">
      <OptionChainGuide opened={guideOpened} onClose={close} />

      {/* Header Row */}
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <Text size="lg" fw={600} style={{ whiteSpace: "nowrap" }}>
            Option Chain
          </Text>
          <LiveSpotChart underlying={selectedUnderlying} />
          {timestamp && !loading && (
            <MantineTooltip
              label={`Data as of ${dayjs(timestamp).format("DD MMM YYYY, HH:mm:ss")}`}
            >
              <Badge variant="light" color="gray" leftSection={<IconClock size={12} />}>
                {dayjs(timestamp).format("HH:mm:ss")}
              </Badge>
            </MantineTooltip>
          )}
        </Group>
        <Group gap="sm">
          <Button
            variant="light"
            color="blue"
            size="compact-xs"
            leftSection={<IconHelpCircle size={14} />}
            onClick={open}
            data-testid="open-guide-btn"
          >
            Guide
          </Button>
          <Text size="sm" c="dimmed">
            {selectedUnderlying} · {selectedExpiry}
          </Text>
          <IconRefresh
            size={18}
            style={{ cursor: "pointer", opacity: loading ? 0.5 : 1 }}
            onClick={() => !loading && refreshChain()}
            data-testid="refresh-chain-btn"
          />
        </Group>
      </Group>

      {/* Controls */}
      <OptionChainHeader
        selectedUnderlying={selectedUnderlying}
        selectedExpiry={selectedExpiry}
        setUnderlying={setUnderlying}
        setExpiry={setExpiry}
        availableUnderlyings={availableUnderlyings}
        availableExpiries={availableExpiries}
      />

      <OptionChainFilters filters={filters} setFilters={setFilters} />

      {/* Error State */}
      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          data-testid="chain-error-alert"
        >
          {error}
        </Alert>
      )}

      {/* Content */}
      {loading && strikeMatrix.length === 0 ? (
        <Group justify="center" py="xl" data-testid="chain-loading">
          <Loader size="md" />
          <Text c="dimmed">Loading option chain...</Text>
        </Group>
      ) : strikeMatrix.length === 0 ? (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="yellow"
          variant="light"
          data-testid="no-data-alert"
        >
          No options data available. Select an underlying and expiry to view the chain.
        </Alert>
      ) : (
        <Tabs
          defaultValue="table"
          variant="pills"
          styles={{ tab: { fontSize: 11, fontWeight: 600 } }}
          data-testid="chain-view-tabs"
        >
          <Tabs.List mb="sm">
            <Tabs.Tab
              value="table"
              leftSection={<IconTable size={14} />}
              data-testid="chain-tab-table"
            >
              Option Chain Table
            </Tabs.Tab>
            <Tabs.Tab
              value="analysis"
              leftSection={<IconChartBar size={14} />}
              data-testid="chain-tab-analysis"
            >
              Deep OI Analysis
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="table">
            <Stack gap="md">
              <ChainSummary
                strikeMatrix={strikeMatrix}
                spotPrice={spotPrice}
                selectedExpiry={selectedExpiry}
                summary={summary}
              />
              <OptionChainTable
                strikeMatrix={strikeMatrix}
                filters={filters}
                spotPrice={spotPrice}
                onRowClick={(contract) => console.log("clicked", contract)}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="analysis">
            <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={spotPrice} />
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
