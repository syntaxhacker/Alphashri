import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import type { TradeIdea } from "./news-types";

interface TradeIdeaCardProps {
  idea: TradeIdea;
}

export function TradeIdeaCard({ idea }: TradeIdeaCardProps) {
  if (!idea) return null;
  const isLong = idea.direction === "LONG";
  return (
    <ListItem alignItems="flex-start" disablePadding data-testid="trade-idea">
      <ListItemText
        primary={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              size="small"
              color={isLong ? "success" : "error"}
              label={idea.direction}
            />
            <Typography variant="subtitle2">{idea.symbol}</Typography>
          </Box>
        }
        secondary={idea.reasoning || "No reasoning provided."}
        slotProps={{ primary: { component: "div" }, secondary: { variant: "body2" } }}
      />
    </ListItem>
  );
}
