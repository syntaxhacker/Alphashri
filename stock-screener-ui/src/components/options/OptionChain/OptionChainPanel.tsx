import {
  Group,
  Text,
  Stack,
  Badge,
  Loader,
  Alert,
  Tabs,
  TabsList,
  Tab,
  TabsPanel,
  Button,
  Tooltip,
} from "@/ui";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import {
  IconRefresh,
  IconAlertCircle,
  IconTable,
  IconChartBar,
  IconHelpCircle,
  IconClock,
} from "@tabler/icons-react";
import { useDisclosure } from "@/ui";
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
    <Stack
      id="chain-panel"
      spacing={1}
      sx={{ height: "100%" }}
      data-testid="options-chain-panel"
    >
      <OptionChainGuide opened={guideOpened} onClose={close} />

      {/* Header Row */}
      <Group
        id="chain-header"
       
        justify="space-between"
        wrap="nowrap"
        data-testid="options-chain-header"
      >
        <Group gap="xs" wrap="nowrap">
          <Text size="md" fw={600} sx={{ whiteSpace: "nowrap" }}>
            Option Chain
          </Text>
          <LiveSpotChart underlying={selectedUnderlying} />
          {timestamp && !loading && (
            <Tooltip
              label={`Data as of ${dayjs(timestamp).format("DD MMM YYYY, HH:mm:ss")}`}
            >
              <Badge
                variant="light"
                color="gray"
                leftSection={<IconClock size={12} />}
               
                data-testid="options-chain-timestamp"
              >
                {dayjs(timestamp).format("HH:mm:ss")}
              </Badge>
            </Tooltip>
          )}
        </Group>
        <Group gap="xs">
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
          <Text
            size="xs"
            c="dimmed"
           
            data-testid="options-chain-selection"
          >
            {selectedUnderlying} · {selectedExpiry}
          </Text>
          <Box
            component={IconRefresh}
            size={18}
            sx={{ opacity: loading ? 0.5 : 1, cursor: "pointer" }}
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
          id="chain-error"
         
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
        <Group
          id="chain-loading"
         
          justify="center"
          py="xl"
          data-testid="chain-loading"
        >
          <Loader size="md" />
          <Text c="dimmed">Loading option chain...</Text>
        </Group>
      ) : strikeMatrix.length === 0 ? (
        <Alert
          id="chain-no-data"
         
          icon={<IconAlertCircle size={16} />}
          color="yellow"
          variant="light"
          data-testid="no-data-alert"
        >
          No options data available. Select an underlying and expiry to view the chain.
        </Alert>
      ) : (
        <Tabs
          id="chain-view-tabs"
         
          defaultValue="table"
          data-testid="chain-view-tabs"
        >
          <TabsList
           
            mb="sm"
            data-testid="options-chain-view-tabs-list"
          >
            <Tab
              value="table"
             
              leftSection={<IconTable size={14} />}
              data-testid="chain-tab-table"
            >
              Option Chain Table
            </Tab>
            <Tab
              value="analysis"
             
              leftSection={<IconChartBar size={14} />}
              data-testid="chain-tab-analysis"
            >
              Deep OI Analysis
            </Tab>
          </TabsList>

          <TabsPanel
            value="table"
           
            data-testid="options-chain-table-panel"
          >
            <Stack gap="sm">
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
          </TabsPanel>

          <TabsPanel
            value="analysis"
           
            data-testid="options-chain-analysis-panel"
          >
            <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={spotPrice} />
          </TabsPanel>
        </Tabs>
      )}
    </Stack>
  );
}
