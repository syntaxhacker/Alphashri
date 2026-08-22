import { Badge, Text } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import type { SectorAlert } from "./sectorUtils";
import { formatPercentage } from "../../utils/ui-helpers";

function DirectionBadge({ alert }: { alert: SectorAlert }) {
  return (
    <Badge color={alert.direction === "SURGING" ? "green" : "red"} size="sm">
      {alert.direction} ({formatPercentage(alert.delta, 2, false)})
    </Badge>
  );
}

const columns: ColumnDef<SectorAlert>[] = [
  {
    id: "timestamp",
    header: "Time",
    accessorKey: "timestamp",
    cell: (info) => (
      <Text size="sm" fw={700}>
        {info.getValue<string>()}
      </Text>
    ),
  },
  {
    id: "sector",
    header: "Sector",
    accessorKey: "sector",
    cell: (info) => <Text size="sm">{info.getValue<string>()}</Text>,
  },
  {
    id: "direction",
    header: "Move",
    accessorKey: "direction",
    cell: ({ row }) => <DirectionBadge alert={row.original} />,
  },
];

export function SectorAlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        Waiting for major movements...
      </Text>
    );
  }

  return (
    <TanStackTable<SectorAlert>
      data={alerts}
      columns={columns}
      enableSorting={false}
      dataTestId="sector-alerts-table"
    />
  );
}
