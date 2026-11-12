import type { JSX } from "solid-js";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import { ActionIcon, Box, Text, Tooltip } from "@/ui";
import { TEXT_MUTED, WARNING } from "@/ui/palette";
import { IconChevronRight } from "../common/Icons";
import type { EventDTO } from "../../types/events";
import { SymbolLink } from "../common/SymbolLink";
import { EventTypeBadge } from "./EventTypeBadge";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format `YYYY-MM-DD` as "Oct 28".
 *
 * Parsed from the string parts rather than `new Date(value)`: the latter reads
 * a date-only string as UTC midnight, which renders as the previous day for
 * every user west of Greenwich.
 */
export function formatEventDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${MONTHS[month - 1] ?? ""} ${day}`.trim();
}

/** "today" for 0, "in 3d" for future, "3d ago" for past. */
export function formatDaysUntil(days: number): string {
  if (days === 0) return "today";
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}

/**
 * Colour for the lead-time column: past/today is de-emphasised, the next week
 * is the actionable window, everything further out inherits normal text.
 */
export function daysUntilColor(days: number): string {
  if (days <= 0) return TEXT_MUTED;
  if (days <= 7) return WARNING;
  return "inherit";
}

export function buildEventColumns(onOpen: (event: EventDTO) => void): ColumnDef<EventDTO>[] {
  return [
    {
      id: "symbol",
      header: "SYMBOL",
      accessorFn: (row) => row.symbol,
      meta: { align: "left" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <SymbolLink
            symbol={event.symbol}
            testId={`event-symbol-${event.id}`}
            chartTestId={`event-chart-${event.id}`}
            size="xs"
            weight={700}
          />
        );
      },
    },
    {
      id: "event_type",
      header: "TYPE",
      accessorFn: (row) => row.event_type,
      meta: { align: "center" },
      cell: ({ row }) => (
        <EventTypeBadge type={row.original.event_type} isAlpha={row.original.is_alpha} />
      ),
    },
    {
      id: "title",
      header: "EVENT",
      accessorFn: (row) => row.title,
      meta: { align: "left" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <Tooltip label={event.title}>
            <Box className="max-w-[360px] min-w-0">
              <Text size="xs" truncate data-testid={`event-title-${event.id}`}>
                {event.title}
              </Text>
            </Box>
          </Tooltip>
        );
      },
    },
    {
      id: "event_date",
      header: "DATE",
      accessorFn: (row) => row.event_date,
      meta: { align: "center" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <Text size="xs" data-testid={`event-date-${event.id}`}>
            {formatEventDate(event.event_date)}
          </Text>
        );
      },
    },
    {
      id: "days_until",
      header: "IN",
      accessorFn: (row) => row.days_until,
      meta: { align: "right" },
      cell: ({ row }) => {
        const event = row.original;
        const days = event.days_until;
        return (
          <Text
            size="xs"
            fw={days > 0 && days <= 7 ? 600 : 400}
            c={daysUntilColor(days)}
            data-testid={`event-days-${event.id}`}
          >
            {formatDaysUntil(days)}
          </Text>
        );
      },
    },
    {
      id: "announced_at",
      header: "ANNOUNCED",
      accessorFn: (row) => row.announced_at ?? "",
      meta: { align: "center" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <Text
            size="xs"
            c={event.announced_at ? undefined : "dimmed"}
            data-testid={`event-announced-${event.id}`}
          >
            {formatEventDate(event.announced_at)}
          </Text>
        );
      },
    },
    {
      id: "source",
      header: "SOURCE",
      accessorFn: (row) => row.source,
      meta: { align: "center" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <Text
            size="xs"
            c="dimmed"
            tt="uppercase"
            className="text-[10px] tracking-[0.4px]"
            data-testid={`event-source-${event.id}`}
          >
            {event.source}
          </Text>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      meta: { align: "center" },
      cell: ({ row }) => {
        const event = row.original;
        return (
          <ActionIcon
            size="xs"
            variant="subtle"
            style={{ width: 16, height: 16, minHeight: 16, padding: 0 }}
            aria-label={`Open ${event.symbol} event`}
            data-testid={`event-open-${event.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(event);
            }}
          >
            <IconChevronRight size={14} />
          </ActionIcon>
        );
      },
    },
  ];
}
