import { formatNumberIN } from "@/utils/ui-helpers";
import { useState, type ReactNode } from "react";
import Divider from "@mui/material/Divider";
import { ActionIcon, Box, Button, Modal, Text, Textarea, Tooltip } from "@/ui";
import {
  IconAlertTriangle,
  IconClipboardText,
  IconPencil,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { JobStatus } from "./JobStatus";
import { parseSymbolList } from "./parseSymbolList";

export interface UniverseBarProps {
  universes: Universe[];
  universe: string;
  setUniverse: (value: string) => void;
  /** Reserved id of the custom symbol scope (e.g. `"custom"`). */
  customUniverse?: string;
  /** How many symbols the custom scope currently holds (drives the label). */
  customSymbolCount?: number;
  scan: () => void;
  scanning: boolean;
  job: JobDTO | null;
  queuePosition: number | null;
  error: string | null;
  /** Right-side controls rendered in the same toolbar row (timeframe, filters…). */
  actions?: ReactNode;
  /** Scan-status controls rendered next to the scan button (cache, force re-run…). */
  scanActions?: ReactNode;
  /** Apply a pasted symbol list (switches to the custom universe). */
  onPasteSymbols?: (symbols: string[]) => void;
}

/**
 * Scan-scope toolbar.
 *
 * Three fixed rows: scope + action, caller-supplied result controls, and an
 * error line. The scope is a single segmented group (one border, one selected
 * fill) rather than a row of loose pills, so the bar reads as one control and
 * its right-hand status / scan cluster never drifts. The whole bar is sticky
 * (`top: 0`) with a divider so content scrolling underneath stays legible.
 */
export function UniverseBar({
  universes,
  universe,
  setUniverse,
  customUniverse = "custom",
  customSymbolCount = 0,
  scan,
  scanning,
  job,
  queuePosition,
  error,
  actions,
  scanActions,
  onPasteSymbols,
}: UniverseBarProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const parsed = parseSymbolList(pasteText);
  const applyPaste = () => {
    if (!parsed.length) return;
    onPasteSymbols?.(parsed);
    setPasteOpen(false);
    setPasteText("");
  };
  // Idle and completed scans are already summarised by the stat strip above
  // ("LAST SCAN …", "LAST CANDLE …"); the inline status is only worth its
  // ~200px while a scan is queued/running or has failed. It stays mounted
  // (display:none) so the `patterns-job-status` contract is preserved.
  const liveStatuses = new Set(["queued", "running", "failed", "cancelled"]);
  const showStatus = scanning || (job != null && liveStatuses.has(job.status));
  const customActive = universe === customUniverse;
  const customCount = customSymbolCount ?? 0;
  const scanDisabled = scanning || (customActive && customCount === 0);
  const scanLabel =
    customActive && customCount > 0
      ? `Scan ${customCount} symbol${customCount === 1 ? "" : "s"}`
      : "Scan again";

  return (
    <Box
      data-testid="patterns-universe-bar"
      sx={{
        minWidth: 0,
        position: "sticky",
        top: 0,
        zIndex: 5,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        pb: 0.5,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          rowGap: 0.75,
          minWidth: 0,
          // Wrap the scan cluster to a second line instead of clipping the
          // scope group when the cache chip + force re-run are on screen.
          flexWrap: "wrap",
        }}
      >
        <Text
          size="xs"
          c="dimmed"
          sx={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Scope
        </Text>

        <Box
          role="group"
          aria-label="Scan scope"
          sx={{
            display: "inline-flex",
            alignItems: "stretch",
            gap: 0.25,
            p: 0.25,
            minWidth: 0,
            border: 1,
            borderColor: "divider",
            borderRadius: 1.5,
            bgcolor: "action.hover",
            flexWrap: "wrap",
            rowGap: 0.25,
          }}
        >
          {universes.map((u) => {
            const active = universe === u.id;
            return (
              <Box
                key={u.id}
                component="button"
                type="button"
                onClick={() => setUniverse(u.id)}
                aria-pressed={active}
                title={u.count > 0 ? `${u.label} · ${formatNumberIN(u.count)} symbols` : u.label}
                data-testid={`patterns-universe-${u.id}`}
                sx={{
                  appearance: "none",
                  border: 0,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 0.5,
                  px: 0.75,
                  py: 0.375,
                  borderRadius: 1,
                  whiteSpace: "nowrap",
                  fontFamily: "inherit",
                  fontSize: 11,
                  lineHeight: 1.25,
                  fontWeight: active ? 600 : 500,
                  color: active ? "primary.main" : "text.secondary",
                  bgcolor: active ? "action.selected" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px var(--mui-palette-primary-main)" : "none",
                  "&:hover": {
                    color: active ? "primary.main" : "text.primary",
                    bgcolor: active ? "action.selected" : "action.hover",
                  },
                  "&:focus-visible": {
                    outline: "2px solid var(--mui-palette-primary-main)",
                    outlineOffset: 1,
                  },
                }}
              >
                {u.label}
                {u.count > 0 ? (
                  <Box
                    component="span"
                    sx={{
                      fontSize: 9.5,
                      fontWeight: 500,
                      fontVariantNumeric: "tabular-nums",
                      color: active ? "primary.main" : "text.disabled",
                      opacity: active ? 0.9 : 1,
                    }}
                  >
                    {formatNumberIN(u.count)}
                  </Box>
                ) : null}
              </Box>
            );
          })}

          <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />

          <Box
            component="button"
            type="button"
            onClick={() => setUniverse(customUniverse)}
            aria-pressed={customActive}
            data-testid="patterns-universe-custom"
            sx={{
              appearance: "none",
              border: 0,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              px: 0.75,
              py: 0.375,
              borderRadius: 1,
              whiteSpace: "nowrap",
              fontFamily: "inherit",
              fontSize: 11,
              lineHeight: 1.25,
              fontWeight: customActive ? 600 : 500,
              color: customActive ? "primary.main" : "text.secondary",
              bgcolor: customActive ? "action.selected" : "transparent",
              boxShadow: customActive ? "inset 0 0 0 1px var(--mui-palette-primary-main)" : "none",
              "&:hover": {
                color: customActive ? "primary.main" : "text.primary",
                bgcolor: customActive ? "action.selected" : "action.hover",
              },
              "&:focus-visible": {
                outline: "2px solid var(--mui-palette-primary-main)",
                outlineOffset: 1,
              },
            }}
          >
            <IconPencil size={11} />
            Custom
            {customCount > 0 ? (
              <Box
                component="span"
                sx={{
                  fontSize: 9.5,
                  fontWeight: 500,
                  fontVariantNumeric: "tabular-nums",
                  color: customActive ? "primary.main" : "text.disabled",
                }}
              >
                {formatNumberIN(customCount)}
              </Box>
            ) : null}
          </Box>
        </Box>

        {onPasteSymbols ? (
          <Tooltip label="Paste a comma or newline separated symbol list">
            <ActionIcon
              size="xs"
              variant="outline"
              aria-label="Paste symbols"
              onClick={() => setPasteOpen(true)}
              data-testid="patterns-paste-symbols"
              sx={{ flexShrink: 0 }}
            >
              <IconClipboardText size={14} />
            </ActionIcon>
          </Tooltip>
        ) : null}

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            flexShrink: 0,
            flexWrap: "wrap",
            justifyContent: "flex-end",
            ml: "auto",
            minWidth: 0,
          }}
        >
          <Box
            data-testid="patterns-job-status-wrap"
            data-visible={showStatus ? "true" : "false"}
            sx={{ display: showStatus ? "flex" : "none", minWidth: 0 }}
          >
            <JobStatus job={job} queuePosition={queuePosition} scanning={scanning} />
          </Box>
          {scanActions}
          <Button
            size="xs"
            variant="filled"
            onClick={scan}
            loading={scanning}
            disabled={scanDisabled}
            leftSection={scanning ? undefined : <IconPlayerPlay size={13} />}
            data-testid="patterns-scan-again"
            sx={{ minWidth: 96, whiteSpace: "nowrap" }}
          >
            {scanLabel}
          </Button>
        </Box>
      </Box>

      {actions ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 0.25,
            mt: 0.5,
            pt: 0.5,
            borderTop: 1,
            borderColor: "divider",
            minWidth: 0,
          }}
        >
          {actions}
        </Box>
      ) : null}

      {error ? (
        <Box
          role="alert"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.75,
            px: 0.75,
            py: 0.375,
            borderRadius: 1,
            bgcolor: "action.hover",
            borderLeft: 3,
            borderColor: "error.main",
            color: "error.main",
          }}
        >
          <IconAlertTriangle size={13} />
          <Text size="xs" c="error" data-testid="patterns-status-line">
            {error}
          </Text>
        </Box>
      ) : null}

      <Modal
        opened={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste symbols"
        size="sm"
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Text size="xs" sx={{ color: "text.secondary" }}>
            Comma, space or newline separated. Duplicates are removed.
          </Text>
          <Textarea
            value={pasteText}
            onChange={setPasteText}
            placeholder="ASIANPAINT, CIPLA, LT, NTPC…"
            minRows={5}
            autosize
            autoFocus
            data-testid="patterns-paste-symbols-input"
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button size="xs" variant="light" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              variant="filled"
              onClick={applyPaste}
              disabled={!parsed.length}
              data-testid="patterns-paste-symbols-apply"
            >
              Use {parsed.length || ""} symbol{parsed.length === 1 ? "" : "s"}
            </Button>
          </Box>
        </Box>
      </Modal>
    </Box>
  );
}
