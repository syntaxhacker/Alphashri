import { Modal, Text, Badge, List, ListItem, ThemeIcon } from "@/ui";
import Paper from "@mui/material/Paper";
import Grid from "@mui/material/Grid";
import CardContent from "@mui/material/CardContent";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { IconInfoCircle, IconTarget } from "@tabler/icons-react";

interface OptionChainGuideProps {
  opened: boolean;
  onClose: () => void;
}

export function OptionChainGuide({ opened, onClose }: OptionChainGuideProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="How to Read the Option Chain"
      size="lg"
      centered
      radius="md"
      className="option-chain-guide-modal"
      data-testid="options-chain-guide-modal"
    >
      <Stack spacing={1} sx={{ alignItems: "center", width: "100%" }} className="guide-content" data-testid="options-guide-content">
        <Text size="sm" c="dimmed" className="guide-intro" sx={{ textAlign: "center" }}>
          Options can be complex. Here is a simple guide to help you understand the data and make better decisions.
        </Text>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", py: 1 }}>
          <Text size="sm" fw={700}>The Basics</Text>
        </Box>

        <Grid container spacing={1} sx={{ justifyContent: "center", width: "100%" }} data-testid="options-guide-basics">
          <Grid size={{ xs: 12, sm: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
            <Paper elevation={1} sx={{ p: 1, width: "100%" }} className="guide-card guide-card-calls">
              <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                <Text fw={700} size="sm" c="success">CALLS (CE)</Text>
                <Text size="sm">Right to buy. Traders buy CE if they expect the price to **GO UP**.</Text>
              </CardContent>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
            <Paper elevation={1} sx={{ p: 1, width: "100%" }} className="guide-card guide-card-puts">
              <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
                <Text fw={700} size="sm" c="error">PUTS (PE)</Text>
                <Text size="sm">Right to sell. Traders buy PE if they expect the price to **GO DOWN**.</Text>
              </CardContent>
            </Paper>
          </Grid>
        </Grid>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", py: 1 }}>
          <Text size="sm" fw={700}>Key Indicators</Text>
        </Box>

        <List spacing="xs" size="sm" className="guide-indicators" data-testid="options-guide-indicators" icon={<ThemeIcon color="primary" size={20} radius="xl"><IconInfoCircle size={12} /></ThemeIcon>}>
          <ListItem className="guide-indicator-item" data-testid="options-guide-pcr">
            <Text component="span" fw={700}>PCR (Put-Call Ratio):</Text> If {">"} 1.2, more puts are being sold (Bullish). If {"<"} 0.7, more calls are being sold (Bearish).
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-max-pain">
            <Text component="span" fw={700}>Max Pain:</Text> The price level where option buyers lose the most money. Market often tends to gravitate towards this level on expiry.
          </ListItem>
          <ListItem className="guide-indicator-item" data-testid="options-guide-oi">
            <Text component="span" fw={700}>Open Interest (OI):</Text> The total number of open contracts. High OI acts as a "Wall" (Support or Resistance).
          </ListItem>
        </List>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", py: 1 }}>
          <Text size="sm" fw={700}>Sentiment Badges (What are they doing?)</Text>
        </Box>

        <Stack spacing={1} sx={{ width: "100%", alignItems: "center" }} data-testid="options-guide-badges">
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center" }} data-testid="options-guide-badge-lb">
            <Badge color="success" variant="light" w={80}>LB</Badge>
            <Text size="sm" fw={700}>Long Buildup:</Text>
            <Text size="sm">New buyers entering. **Strong Bullish signal.**</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center" }} data-testid="options-guide-badge-sb">
            <Badge color="error" variant="light" w={80}>SB</Badge>
            <Text size="sm" fw={700}>Short Buildup:</Text>
            <Text size="sm">Sellers creating new positions. **Strong Bearish signal.**</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center" }} data-testid="options-guide-badge-sc">
            <Badge color="info" variant="light" w={80}>SC</Badge>
            <Text size="sm" fw={700}>Short Covering:</Text>
            <Text size="sm">Sellers closing positions. **Price usually bounces up.**</Text>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center" }} data-testid="options-guide-badge-lu">
            <Badge color="warning" variant="light" w={80}>LU</Badge>
            <Text size="sm" fw={700}>Long Unwinding:</Text>
            <Text size="sm">Buyers closing positions. **Price usually profit books (down).**</Text>
          </Box>
        </Stack>

        <Paper elevation={1} sx={{ p: 1, width: "100%" }} className="guide-pro-tip" data-testid="options-guide-pro-tip">
          <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, justifyContent: "center" }}>
              <IconTarget size={20} color="var(--mui-palette-primary-main)" />
              <Text size="sm" fw={600} c="primary">
                PRO TIP: Look for strikes where both OI and Volume are spiking with an "LB" badge—that's where the next big move might happen!
              </Text>
            </Box>
          </CardContent>
        </Paper>
      </Stack>
    </Modal>
  );
}
