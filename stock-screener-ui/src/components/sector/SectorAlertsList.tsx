import { Badge, Text, Box, Stack } from "@/ui";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";
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
    header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Time</Box>,
    accessorKey: "timestamp",
    meta: { align: "center" },
    cell: (info) => (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Text size="sm" fw={700}>
          {info.getValue<string>()}
        </Text>
      </Box>
    ),
  },
  {
    id: "sector",
    header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Sector</Box>,
    accessorKey: "sector",
    meta: { align: "center" },
    cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text size="sm">{info.getValue<string>()}</Text></Box>,
  },
  {
    id: "direction",
    header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Move</Box>,
    accessorKey: "direction",
    meta: { align: "center" },
    cell: ({ row }) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><DirectionBadge alert={row.original} /></Box>,
  },
];

export function SectorAlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Text size="sm" c="dimmed" ta="center" py="xl">
          Waiting for major movements...
        </Text>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ p: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Stack gap={1} sx={{ width: "100%", alignItems: "center" }}>
        <CardContent sx={{ p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <TanStackTable<SectorAlert>
            data={alerts}
            columns={columns}
            enableSorting={false}
            dataTestId="sector-alerts-table"
          />
        </CardContent>
      </Stack>
    </TableContainer>
  );
}
