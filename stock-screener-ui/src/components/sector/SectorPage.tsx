import { Box, Group, Text, Button, Anchor, Stack } from "@mantine/core";
import { IconExternalLink, IconBook } from "@tabler/icons-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

export function SectorPage() {
  return (
    <Box
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
      data-testid="sector-analysis-view"
    >
      <Box
        flex="0 0 auto"
        style={{ padding: "var(--mantine-spacing-md)" }}
        className="sector-analysis-header"
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <h2>Sector Analysis</h2>
              <Text size="sm" c="dimmed">
                Historical sector rotation dashboard
              </Text>
            </div>
            <Group gap="xs">
              <Anchor href={`${API_BASE}/sector/usage.md`} target="_blank" rel="noreferrer">
                <Button leftSection={<IconBook size={14} />} variant="light" size="xs" radius="sm">
                  Usage Guide
                </Button>
              </Anchor>
              <Anchor
                href={`${API_BASE}/sector/dashboard-modular.html`}
                target="_blank"
                rel="noreferrer"
              >
                <Button
                  leftSection={<IconExternalLink size={14} />}
                  variant="filled"
                  size="xs"
                  radius="sm"
                >
                  Open Fullscreen
                </Button>
              </Anchor>
            </Group>
          </Group>

          <Text
            size="xs"
            c="dimmed"
            style={{ fontStyle: "italic" }}
            className="sector-analysis-note"
          >
            Optional: run <code>historical_sector_cycles/sector_contributors_api.py</code> for
            volume endpoints on <code>:5555</code>.
          </Text>
        </Stack>
      </Box>

      <Box
        flex={1}
        style={{ minHeight: 0, padding: "0 var(--mantine-spacing-md) var(--mantine-spacing-md)" }}
      >
        <Box
          h="100%"
          className="sector-analysis-frame-wrap"
          style={{
            borderRadius: "var(--mantine-radius-default)",
            overflow: "hidden",
            border: "1px solid var(--mantine-color-dark-4)",
          }}
        >
          <iframe
            src={`${API_BASE}/sector/dashboard-modular.html`}
            title="Sector Rotation Dashboard"
            className="sector-analysis-frame"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
            }}
            data-testid="sector-iframe"
          />
        </Box>
      </Box>
    </Box>
  );
}
