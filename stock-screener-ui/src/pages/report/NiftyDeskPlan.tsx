import { memo, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { alpha } from "@mui/material/styles";
import KeyboardArrowDown from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRight from "@mui/icons-material/KeyboardArrowRight";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import type { NiftyReport } from "@/types/niftyReport";
import {
  buildDeskPlan,
  fmtDeskNum,
  fmtDeskRr,
  type DeskBias,
  type DeskReasonTag,
  type DeskSide,
} from "./deskPlan";

/**
 * Two-sided desk plan: what to DO and what NOT to do on each side of the book.
 *
 * Both columns are always rendered because the desk argues both cases: the
 * active bias gets the coloured badge, the other side reads NEUTRAL. The
 * numbers come from `buildDeskPlan`, which is pure and data-only — this file
 * is presentation, not reasoning.
 *
 * The panel is collapsible (open by default, no persistence) and its body is
 * height-capped so the chart below stays on screen at 1080p.
 */

const TAG_COLORS: Record<DeskReasonTag, string> = {
  trend: palette.PRIMARY,
  gamma: palette.TERM_GAMMA,
  oi: palette.TERM_CE,
  vol: palette.WARNING,
  structure: palette.TERM_PE,
};

const NO_TRADE = "NO TRADE — wait";

function biasAccent(bias: DeskBias): string {
  if (bias === "bullish") return palette.POSITIVE;
  if (bias === "bearish") return palette.NEGATIVE;
  return palette.WARNING;
}

const SectionLabel = memo(function SectionLabel({
  children,
  color,
  testId,
}: {
  children: string;
  color: string;
  testId?: string;
}) {
  return (
    <Text
      data-testid={testId}
      size="xs"
      fw={800}
      span
      style={{
        color,
        fontSize: 9,
        lineHeight: 1.2,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
});
SectionLabel.displayName = "SectionLabel";

function BiasBadge({ bias, side }: { bias: DeskBias; side: "bull" | "bear" }) {
  const accent = biasAccent(bias);
  return (
    <Box
      data-testid={`desk-bias-${side}`}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 0.75,
        py: 0.125,
        borderRadius: 999,
        border: `1px solid ${alpha(accent, 0.5)}`,
        bgcolor: alpha(accent, 0.12),
        flexShrink: 0,
      }}
    >
      <Text
        span
        size="xs"
        fw={800}
        style={{ color: accent, fontSize: 9, lineHeight: 1.2, letterSpacing: "0.08em" }}
      >
        {bias.toUpperCase()}
      </Text>
    </Box>
  );
}

/**
 * Inline Stop / Target / R:R stats. No nested cards — one divider separates
 * each pair so the DO block stays two lines shorter than the old card grid.
 */
function InlineStats({ side, noTrade }: { side: DeskSide; noTrade: boolean }) {
  const stats: Array<{ label: string; value: string; testId: string }> = [
    {
      label: "Stop",
      value: noTrade ? "—" : fmtDeskNum(side.stop),
      testId: `desk-do-${side.side}-stop`,
    },
    {
      label: "Target",
      value: noTrade ? "—" : fmtDeskNum(side.target),
      testId: `desk-do-${side.side}-target`,
    },
    {
      label: "R:R",
      value: noTrade ? "—" : fmtDeskRr(side.rr),
      testId: `desk-do-${side.side}-rr`,
    },
  ];

  return (
    <Box
      data-testid={`desk-do-${side.side}-stats`}
      sx={{
        display: "flex",
        alignItems: "baseline",
        flexWrap: "wrap",
        columnGap: 1,
        rowGap: 0.25,
        minWidth: 0,
      }}
    >
      {stats.map((stat, index) => (
        <Box
          key={stat.label}
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 0.5,
            minWidth: 0,
            ...(index > 0 && {
              pl: 1,
              borderLeft: `1px solid ${palette.TERM_BORDER}`,
            }),
          }}
        >
          <Text
            size="xs"
            fw={700}
            c="dimmed"
            span
            style={{ fontSize: 9, lineHeight: 1.2, letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            {stat.label}
          </Text>
          <Text
            data-testid={stat.testId}
            size="xs"
            fw={800}
            span
            style={{ fontSize: 12, lineHeight: 1.3, fontVariantNumeric: "tabular-nums" }}
          >
            {stat.value}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function DeskSideColumn({
  side,
  label,
  noTrade,
}: {
  side: DeskSide;
  label: string;
  noTrade: boolean;
}) {
  const accent = side.side === "bull" ? palette.POSITIVE : palette.NEGATIVE;
  const trigger = side.alternate
    ? `${side.entryTrigger}, or ${side.alternate.trigger}`
    : side.entryTrigger;

  return (
    <Box
      data-testid={`desk-side-${side.side}`}
      sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pb: 0.5,
          borderBottom: `1px solid ${palette.TERM_BORDER}`,
          minWidth: 0,
        }}
      >
        <Text
          span
          size="xs"
          fw={800}
          style={{ color: accent, fontSize: 11, lineHeight: 1.2, letterSpacing: "0.08em" }}
        >
          {label}
        </Text>
        <BiasBadge bias={side.bias} side={side.side} />
      </Box>

      <Box
        data-testid={`desk-do-${side.side}`}
        sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}
      >
        <SectionLabel color={accent} testId={`desk-do-label-${side.side}`}>
          Do
        </SectionLabel>
        <Text
          data-testid={`desk-do-${side.side}-action`}
          size="xs"
          fw={700}
          lh={1.3}
          style={{ fontSize: 11 }}
        >
          {side.action}
        </Text>
        <Text
          data-testid={`desk-do-${side.side}-trigger`}
          size="xs"
          c="dimmed"
          lh={1.35}
          style={{ fontSize: 10 }}
        >
          {noTrade ? NO_TRADE : trigger}
        </Text>
        <InlineStats side={side} noTrade={noTrade} />
      </Box>

      <Box
        data-testid={`desk-dont-${side.side}`}
        sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}
      >
        <SectionLabel color={palette.WARNING} testId={`desk-dont-label-${side.side}`}>
          Don't
        </SectionLabel>
        {side.doNots.map((line, index) => (
          <Box
            key={`${side.side}-dont-${index}`}
            data-testid={`desk-dont-${side.side}-${index}`}
            sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, minWidth: 0 }}
          >
            <Text span size="xs" fw={800} style={{ color: palette.WARNING, fontSize: 10, lineHeight: 1.35 }}>
              ×
            </Text>
            <Text size="xs" c="dimmed" lh={1.35} style={{ fontSize: 10 }}>
              {line}
            </Text>
          </Box>
        ))}
      </Box>

      {side.reasons.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
          <SectionLabel color={palette.TEXT_MUTED} testId={`desk-reasons-label-${side.side}`}>
            Reasons
          </SectionLabel>
          <Box
            component="ol"
            data-testid={`desk-reasons-${side.side}`}
            sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}
          >
            {side.reasons.map((reason, index) => (
              <Box
                component="li"
                key={`${side.side}-${reason.tag}`}
                data-testid={`desk-reason-${side.side}-${index}`}
                sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, minWidth: 0 }}
              >
                <Text
                  span
                  size="xs"
                  fw={700}
                  c="dimmed"
                  style={{ fontSize: 10, lineHeight: 1.4, minWidth: 12, fontVariantNumeric: "tabular-nums" }}
                >
                  {index + 1}.
                </Text>
                <Box
                  data-testid={`desk-reason-tag-${side.side}-${index}`}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    px: 0.5,
                    borderRadius: 0.5,
                    bgcolor: alpha(TAG_COLORS[reason.tag], 0.14),
                    flexShrink: 0,
                    mt: "1px",
                  }}
                >
                  <Text
                    span
                    size="xs"
                    fw={800}
                    style={{
                      color: TAG_COLORS[reason.tag],
                      fontSize: 8,
                      lineHeight: 1.5,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {reason.tag}
                  </Text>
                </Box>
                <Text size="xs" c="dimmed" lh={1.4} style={{ fontSize: 10 }}>
                  {reason.text}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

interface NiftyDeskPlanProps {
  report: NiftyReport;
}

const BODY_ID = "nifty-desk-plan-body";

function NiftyDeskPlanInner({ report }: NiftyDeskPlanProps) {
  const plan = useMemo(() => buildDeskPlan(report), [report]);
  const [open, setOpen] = useState(true);
  const noTrade = plan.bias === "neutral";

  return (
    <CompactPanel
      flush
      testId="nifty-desk-plan"
      title="Desk plan"
      description="Both sides · ordered by weight"
      action={
        <IconButton
          data-testid="desk-plan-toggle"
          aria-expanded={open}
          aria-controls={BODY_ID}
          aria-label={open ? "Collapse desk plan" : "Expand desk plan"}
          size="small"
          onClick={() => setOpen((value) => !value)}
          sx={{ p: 0.25, color: palette.TEXT_MUTED }}
        >
          {open ? <KeyboardArrowDown fontSize="small" /> : <KeyboardArrowRight fontSize="small" />}
        </IconButton>
      }
      sx={{ flexShrink: 0, minWidth: 0, ...(noTrade ? { opacity: 0.72 } : {}) }}
    >
      {open && (
        <Box
          id={BODY_ID}
          data-testid="desk-plan-body"
          sx={{
            p: 1,
            minWidth: 0,
            // Keep the chart inside the first 1080p screen; the body scrolls
            // internally when both reason lists run long.
            maxHeight: 320,
            overflowY: "auto",
            scrollbarGutter: "stable",
          }}
        >
          {noTrade && (
            <Box
              data-testid="desk-wait-note"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                pb: 0.5,
                mb: 0.5,
                borderBottom: `1px solid ${palette.TERM_BORDER}`,
                minWidth: 0,
              }}
            >
              <Text size="xs" fw={700} c="dimmed" lh={1.3} style={{ fontSize: 10 }}>
                {plan.waitNote}
              </Text>
            </Box>
          )}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" },
              gap: 1,
              minWidth: 0,
            }}
          >
            <DeskSideColumn side={plan.bull} label="BULL" noTrade={noTrade} />
            <DeskSideColumn side={plan.bear} label="BEAR" noTrade={noTrade} />
          </Box>
        </Box>
      )}
    </CompactPanel>
  );
}

export const NiftyDeskPlan = memo(NiftyDeskPlanInner);
NiftyDeskPlan.displayName = "NiftyDeskPlan";
