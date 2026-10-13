import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import { OptionChainHeader } from "./OptionChain/OptionChainHeader";
import { OptionChainFilters } from "./OptionChain/OptionChainFilters";
import { OptionChainPanel } from "./OptionChain/OptionChainPanel";
import { PositionsPanel } from "./OptionPositions/PositionsPanel";
import { GreeksPanel } from "./OptionGreeks/GreeksPanel";
import { OptionsNav } from "./OptionsNav";

interface OptionsPageProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
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
  positions?: any[];
  timestamp?: string;
  summary?: any;
}

export function OptionsPage({
  activeTab,
  setActiveTab,
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
  positions,
  timestamp,
  summary,
}: OptionsPageProps) {
  return (
    <Stack
      id="options-main"
      className="options-page"
      data-testid="options-view"
      spacing={1}
      sx={{ width: "100%" }}
    >
      <Card
        elevation={1}
        data-testid="options-toolbar"
        sx={{ width: "100%", position: "sticky", top: 0, zIndex: 1, p: 1 }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1,
            rowGap: 1,
            width: "100%",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", mr: "auto" }}>
            <OptionsNav activeTab={activeTab} onTabChange={setActiveTab} />
          </Box>
          {activeTab === "chain" && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 2,
                rowGap: 1,
              }}
            >
              <OptionChainHeader
                selectedUnderlying={selectedUnderlying}
                selectedExpiry={selectedExpiry}
                setUnderlying={setUnderlying}
                setExpiry={setExpiry}
                availableUnderlyings={availableUnderlyings}
                availableExpiries={availableExpiries}
              />
              <OptionChainFilters filters={filters} setFilters={setFilters} />
            </Box>
          )}
        </Box>
      </Card>

      <Box sx={{ width: "100%" }}>
        {activeTab === "chain" && (
          <OptionChainPanel
            selectedUnderlying={selectedUnderlying}
            selectedExpiry={selectedExpiry}
            loading={loading}
            error={error}
            filters={filters}
            spotPrice={spotPrice}
            refreshChain={refreshChain}
            strikeMatrix={strikeMatrix}
            timestamp={timestamp}
            summary={summary}
          />
        )}

        {activeTab === "positions" && (
          <Box
            id="positions-container"
            className="options-tab-content"
            data-testid="options-positions-tab"
            sx={{ width: "100%" }}
          >
            <PositionsPanel positions={positions || []} />
          </Box>
        )}

        {activeTab === "greeks" && (
          <Box
            id="greeks-container"
            className="options-tab-content"
            data-testid="options-greeks-tab"
            sx={{ width: "100%" }}
          >
            <GreeksPanel />
          </Box>
        )}
      </Box>
    </Stack>
  );
}
