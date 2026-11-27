import type { JSX } from "solid-js";
import { Anchor, Badge, Box, Card, Divider, Flex, Paper, Stack, Text, Title } from "@/ui";
import * as palette from "@/ui/palette";

// Links must leave the preview iframe and open the Storybook manager.
export const docsHref = (id: string) => `../?path=/docs/${id}`;

const STORIES_COMPONENTS = "src/stories/components";

/**
 * Family pages name their docs directory with a display label ("Data display",
 * "Feedback"); the directory on disk is a slug ("data-display", "feedback").
 * Normalise only that one segment so the footer resolves to a real path on
 * every family page, including those that still pass the old label.
 */
const realStoriesPath = (pages: string): string => {
  if (!pages.startsWith(STORIES_COMPONENTS)) return pages;
  const segments = pages.slice(STORIES_COMPONENTS.length).split("/").filter(Boolean);
  if (segments.length === 0) return STORIES_COMPONENTS;
  if (!/\.[cm]?[jt]sx?$/.test(segments[0])) {
    segments[0] = segments[0].trim().toLowerCase().replace(/\s+/g, "-");
  }
  return `${STORIES_COMPONENTS}/${segments.join("/")}`;
};

export type FamilyComponentRef = { id: string; name: string; note: string };

export const FamilyPage = (props: { children: JSX.Element; width?: string; padding?: string }) => (
  <Stack
    gap="lg"
    style={{
      "max-width": props.width ?? "1120px",
      margin: "0 auto",
      padding: props.padding ?? "4px 0 24px",
    }}
  >
    {props.children}
  </Stack>
);

export const FamilyChip = (props: { name: string; value: string; swatch?: string }) => (
  <Flex
    gap="xs"
    align="center"
    wrap="wrap"
    style={{
      padding: "8px 10px",
      "border-radius": "6px",
      border: `1px solid ${palette.BORDER}`,
      background: palette.SURFACE_ALT,
    }}
  >
    {props.swatch ? (
      <Box
        style={{
          width: "14px",
          height: "14px",
          "flex-shrink": 0,
          "border-radius": "3px",
          background: props.swatch,
          border: `1px solid ${palette.BORDER}`,
        }}
      />
    ) : null}
    <Text size="xs" fw={700} className="font-mono">{props.name}</Text>
    <Text size="xs" c="dimmed" className="font-mono">{props.value}</Text>
  </Flex>
);

export const FamilyHero = (props: {
  name: string;
  purpose: string;
  count: number;
  caption: string;
  specimen: JSX.Element;
  countNote?: string;
}) => (
  <Paper
    p="lg"
    radius="md"
    style={{
      background: palette.SURFACE,
      border: `1px solid ${palette.BORDER}`,
      "border-left": `3px solid ${palette.PRIMARY}`,
    }}
  >
    <Stack gap="md">
      <Flex gap="sm" align="center" wrap="wrap">
        <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Design system · family</Text>
        <Badge size="xs" variant="light" color="primary">
          {`${props.count} ${props.count === 1 ? "component page" : "component pages"}${props.countNote ? ` ${props.countNote}` : ""}`}
        </Badge>
      </Flex>
      <Stack gap="xs">
        <Title order={1} size="xl">{props.name}</Title>
        <Text size="sm" c="default" style={{ "max-width": "780px" }}>{props.purpose}</Text>
      </Stack>
      <Divider />
      <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Specimen · {props.caption}</Text>
      {props.specimen}
    </Stack>
  </Paper>
);

export const ComponentIndex = (props: { items: FamilyComponentRef[]; note?: string }) => (
  <Stack gap="sm">
    <Text size="xs" fw={700} tt="uppercase" c="primary" className="font-mono">Index</Text>
    <Flex gap="sm" align="baseline" wrap="wrap">
      <Title order={2} size="lg">Components in this family</Title>
      <Text size="xs" c="dimmed">{props.note ?? "Open each card to reach its dedicated page."}</Text>
    </Flex>
    <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
      {props.items.map((item) => (
        <Card key={item.id} p="sm" radius="sm" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
          <Stack gap="xs">
            <Anchor href={docsHref(item.id)} target="_top" c="info" fw={600} size="sm" underline="hover">
              {item.name}
            </Anchor>
            <Text size="xs" c="dimmed">{item.note}</Text>
          </Stack>
        </Card>
      ))}
    </div>
  </Stack>
);

export const SpecimenPanel = (props: { title: string; note: string; children: JSX.Element }) => (
  <Paper p="md" radius="md" style={{ background: palette.SURFACE, border: `1px solid ${palette.BORDER}` }}>
    <Stack gap="sm">
      <Flex gap="sm" align="baseline" wrap="wrap">
        <Title order={3} size="md">{props.title}</Title>
        <Text size="xs" c="dimmed">{props.note}</Text>
      </Flex>
      <Divider />
      {props.children}
    </Stack>
  </Paper>
);

export const FamilyFooter = (props: { source: string; pages: string; pagesLabel?: string }) => (
  <Text size="xs" c="dimmed">
    Source: <code>{props.source}</code> · {props.pagesLabel ?? "per-component pages"}: <code>{realStoriesPath(props.pages)}</code>.
  </Text>
);
