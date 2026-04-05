import { Group, Loader, Stack, Text, Alert } from "@mantine/core";
import type { ArticleResponse } from "./news-types";

export function ArticleBody({
  content,
  loading,
  error,
}: {
  content: ArticleResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader size="sm" />
        <Text c="dimmed">Loading article...</Text>
      </Group>
    );
  }
  if (content?.description) {
    return (
      <Stack gap="sm">
        {content.description.split("\n\n").map((para, idx) => (
          <Text key={idx} size="sm">
            {para}
          </Text>
        ))}
      </Stack>
    );
  }
  if (error) {
    return (
      <Alert color="red" variant="light" title="Failed to load article">
        <Text size="sm">{error}</Text>
      </Alert>
    );
  }
  return (
    <Text c="dimmed" ta="center" py="xl">
      Unable to load article content.
    </Text>
  );
}
