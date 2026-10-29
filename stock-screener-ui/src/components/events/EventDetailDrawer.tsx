import Drawer from "@mui/material/Drawer";
import { ActionIcon, Anchor, Badge, Box, Divider, Text, ToolbarRow } from "@/ui";
import { IconExternalLink, IconX } from "@tabler/icons-react";
import type { EventDTO, EventType } from "../../types/events";
import { formatEventDate } from "./eventsColumns";
import { EventTypeBadge } from "./EventTypeBadge";

/** Why an event type can move a stock — one sentence per type. */
export const EVENT_TYPE_HINT: Record<EventType, string> = {
  investor_day:
    "Investor days reset the narrative: management lays out multi-year targets and the market re-rates the story.",
  analyst_day:
    "Analyst days surface segment detail and guidance that rarely reaches the quarterly call.",
  capital_markets_day:
    "Capital-markets days set out financing plans and long-range targets; dilution and leverage usually surface here.",
  strategy_day:
    "Strategy days reframe the business mix, so they move valuation multiples more than near-term EPS.",
  rnd_day:
    "R&D days reveal pipeline depth and spend intent — the read-through is future growth, not this quarter.",
  business_update:
    "Business updates are unscheduled disclosures that can pre-announce a surprise before the quarter closes.",
  guidance:
    "Guidance changes reset the earnings model; the direction of the revision matters more than the print.",
  shareholder_meeting:
    "Shareholder meetings can carry resolutions on buybacks, dividends or control that alter the equity story.",
  earnings:
    "Earnings are the highest-variance event — expect a gap and size for the tail, not the average move.",
  dividend:
    "Dividend actions signal cash confidence; a cut is a stronger signal than a raise.",
  split:
    "Splits do not change value, but they change liquidity and the retail holder base.",
  other:
    "Unclassified corporate events are worth checking against the filing for a hidden catalyst.",
};

interface EventDetailDrawerProps {
  event: EventDTO | null;
  onClose: () => void;
}

function parseDay(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** Whole days between the announcement and the event (null when unknown). */
export function leadTimeDays(event: EventDTO): number | null {
  if (!event.announced_at) return null;
  const announced = parseDay(event.announced_at);
  const happening = parseDay(event.event_date);
  if (!announced || !happening) return null;
  return Math.round((happening.getTime() - announced.getTime()) / 86_400_000);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <ToolbarRow gap={8} justify="space-between" wrap={false}>
      <Text size="xs" c="dimmed" tt="uppercase" sx={{ fontSize: 10, letterSpacing: "0.4px" }}>
        {label}
      </Text>
      <Box sx={{ minWidth: 0, textAlign: "right" }}>{children}</Box>
    </ToolbarRow>
  );
}

export function EventDetailDrawer({ event, onClose }: EventDetailDrawerProps) {
  const lead = event ? leadTimeDays(event) : null;
  const confidence = event
    ? `${Math.round((event.confidence <= 1 ? event.confidence * 100 : event.confidence))}%`
    : "";

  return (
    <Drawer
      anchor="right"
      open={event !== null}
      onClose={onClose}
      sx={{ zIndex: 1300 }}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: 420 },
            maxWidth: "100%",
            bgcolor: "background.paper",
            backgroundImage: "none",
            borderLeft: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      {event && (
        <Box
          data-testid="event-detail-drawer"
          data-event-id={event.id}
          sx={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}
        >
          <ToolbarRow
            gap={8}
            wrap={false}
            justify="space-between"
            sx={{ px: 2, py: 1, borderBottom: "1px solid", borderColor: "divider" }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Text fw={700} truncate data-testid="event-detail-title">
                {event.title}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {[event.symbol, event.exchange, event.name].filter(Boolean).join(" · ")}
              </Text>
            </Box>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="Close event details"
              onClick={onClose}
              data-testid="event-detail-close"
            >
              <IconX size={15} />
            </ActionIcon>
          </ToolbarRow>

          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
            <ToolbarRow gap={8} wrap={false}>
              <EventTypeBadge type={event.event_type} isAlpha={event.is_alpha} />
              <Badge size="xs" color="secondary" data-testid="event-detail-source">
                {event.source.toUpperCase()}
              </Badge>
              {event.recurring ? (
                <Badge size="xs" color="success" data-testid="event-detail-recurring">
                  Recurring
                </Badge>
              ) : (
                <Badge size="xs" color="default" data-testid="event-detail-recurring">
                  One-off
                </Badge>
              )}
            </ToolbarRow>

            <Text size="xs" c="dimmed" data-testid="event-detail-hint">
              {EVENT_TYPE_HINT[event.event_type] ?? EVENT_TYPE_HINT.other}
            </Text>

            <Divider />

            <Field label="Event date">
              <Text size="xs" fw={600} data-testid="event-detail-date">
                {formatEventDate(event.event_date)}
              </Text>
            </Field>
            <Field label="Announced">
              <Text size="xs" data-testid="event-detail-announced">
                {formatEventDate(event.announced_at)}
              </Text>
            </Field>
            <Field label="Lead time">
              <Text size="xs" data-testid="event-detail-lead">
                {lead === null
                  ? "announcement date unknown"
                  : `announced ${lead} day${lead === 1 ? "" : "s"} before`}
              </Text>
            </Field>
            <Field label="Confidence">
              <Text size="xs" data-testid="event-detail-confidence">
                {confidence}
              </Text>
            </Field>

            {event.notes && (
              <>
                <Divider />
                <Box>
                  <Text size="xs" c="dimmed" tt="uppercase" sx={{ fontSize: 10, letterSpacing: "0.4px" }}>
                    Notes
                  </Text>
                  <Text size="xs" data-testid="event-detail-notes">
                    {event.notes}
                  </Text>
                </Box>
              </>
            )}

            {event.source_url && (
              <>
                <Divider />
                <ToolbarRow gap={4} wrap={false}>
                  <IconExternalLink size={14} />
                  <Anchor
                    href={event.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="xs"
                    data-testid="event-detail-source-link"
                    style={{ wordBreak: "break-all" }}
                  >
                    {event.source_url}
                  </Anchor>
                </ToolbarRow>
              </>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
