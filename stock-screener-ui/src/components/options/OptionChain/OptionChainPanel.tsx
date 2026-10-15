import { Text, Badge, Loader, Alert, Tabs, TabsList, Tab, TabsPanel, Button, Tooltip } from "@/ui";
import Stack from "@mui/material/Stack";
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
import { useChainLivePolling } from "../../../hooks/useChainLivePolling";
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
  refreshChain: () => void;
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
  refreshChain,
  strikeMatrix,
  timestamp,
  summary,
}: OptionChainPanelProps) {
  const [guideOpened, { open, close }] = useDisclosure(false);
  // Live sync: 15s chain polling owned by this panel — it mounts only on the
  // chain tab, so switching to positions/greeks unmounts and stops polling.
  const { liveState, manualRefresh } = useChainLivePolling(refreshChain, timestamp);

  return (
    <Stack
      id="chain-panel"
      spacing={1}
      sx={{ width: "100%" }}
      data-testid="options-chain-panel"
    >
      <OptionChainGuide opened={guideOpened} onClose={close} />

      {/* Spot info row — left-aligned, wraps on narrow screens */}
      <Box
        id="chain-header"
        data-testid="options-chain-header"
        sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, rowGap: 1, width: "100%", p: 1 }}
      >
        <LiveSpotChart underlying={selectedUnderlying} />
        {timestamp && !loading && (
          <Tooltip label={`Data as of ${dayjs(timestamp).format("DD MMM YYYY, HH:mm:ss")}`}>
            <Badge variant="light" color="secondary" leftSection={<IconClock size={12} />} data-testid="options-chain-timestamp">
              {dayjs(timestamp).format("HH:mm:ss")}
            </Badge>
          </Tooltip>
        )}
        {timestamp && !loading && (
          <Badge
            variant="light"
            color={liveState.live ? "success" : "warning"}
            data-testid="options-chain-live-badge"
            title={liveState.live ? "Chain is live (auto-refreshes every 15s)" : `Chain data is ${liveState.label.toLowerCase()}`}
          >
            · {liveState.label}
          </Badge>
        )}
        <Text size="xs" c="dimmed" data-testid="options-chain-selection">
          {selectedUnderlying} · {selectedExpiry}
        </Text>
        <Button variant="light" color="primary" size="compact-xs" leftSection={<IconHelpCircle size={14} />} onClick={open} data-testid="open-guide-btn">
          Guide
        </Button>
        {/* A real <button>, not a Box: the merged test suite asserts
            toBeDisabled()/toBeEnabled(), which only exist on a form control.
            nifty-report had this as an icon Box with an opacity tweak, so
            `disabled` was unreachable. */}
        <Box
          component="button"
          type="button"
          disabled={loading}
          aria-label="Refresh option chain"
          onClick={() => !loading && manualRefresh()}
          sx={{
            border: 0,
            background: "transparent",
            p: 0,
            display: "inline-flex",
            alignItems: "center",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.5 : 1,
          }}
          data-testid="refresh-chain-btn"
        >
          <IconRefresh size={18} />
        </Box>
      </Box>

      {/* Error State */}
      {error && (
        <Alert
          id="chain-error"
          icon={<IconAlertCircle size={16} />}
          color="error"
          variant="light"
          data-testid="chain-error-alert"
        >
          {error}
        </Alert>
      )}

      {/* Content */}
      {loading && strikeMatrix.length === 0 ? (
        <Box id="chain-loading" data-testid="chain-loading" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 4, width: "100%" }}>
          <Loader size="md" />
          <Text c="dimmed">Loading option chain...</Text>
        </Box>
      ) : strikeMatrix.length === 0 ? (
        <Alert id="chain-no-data" icon={<IconAlertCircle size={16} />} color="warning" variant="light" data-testid="no-data-alert">
          No options data available. Select an underlying and expiry to view the chain.
        </Alert>
      ) : (
        <Box sx={{ width: "100%" }}>
          <Tabs id="chain-view-tabs" defaultValue="table" data-testid="chain-view-tabs" style={{ width: "100%" }}>
            <TabsList data-testid="options-chain-view-tabs-list">
              <Tab value="table" leftSection={<IconTable size={14} />} data-testid="chain-tab-table">
                Option Chain Table
              </Tab>
              <Tab value="analysis" leftSection={<IconChartBar size={14} />} data-testid="chain-tab-analysis">
                Deep OI Analysis
              </Tab>
            </TabsList>

            <TabsPanel value="table" data-testid="options-chain-table-panel">
              <Stack spacing={1} sx={{ width: "100%" }}>
                <ChainSummary strikeMatrix={strikeMatrix} spotPrice={spotPrice} selectedExpiry={selectedExpiry} summary={summary} />
                <OptionChainTable strikeMatrix={strikeMatrix} filters={filters} spotPrice={spotPrice} onRowClick={(contract) => console.log("clicked", contract)} />
              </Stack>
            </TabsPanel>

            <TabsPanel value="analysis" data-testid="options-chain-analysis-panel">
              <Box sx={{ width: "100%" }}>
                <OIAnalysis strikeMatrix={strikeMatrix} spotPrice={spotPrice} />
              </Box>
            </TabsPanel>
          </Tabs>
        </Box>
      )}
    </Stack>
  );
}
