import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  Alert,
  Box,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  showError,
  showSuccess,
  useMediaQuery,
} from "@/ui";
import { IconTrash, IconUpload } from "@/patterns/icons";
import { PATTERN_CATALOG, PATTERN_LABELS } from "@/config/patternCatalog";
import {
  deletePatternImage,
  fetchPatternImages,
  uploadPatternImage,
} from "@/api/patternImages";
import { PatternImage } from "./PatternImage";

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";

/**
 * Admin panel: upload / replace / delete one reference image per chart pattern.
 * Fetches its own image map on mount and shows a placeholder per card until an
 * image exists.
 */
export function PatternImageManager() {
  const isWide = useMediaQuery("(min-width: 1200px)");
  const isMid = useMediaQuery("(min-width: 760px)");
  const cols = createMemo(() => (isWide() ? 4 : isMid() ? 3 : 2));

  const [images, setImages] = createSignal<Record<string, string>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [busyId, setBusyId] = createSignal<string | null>(null);
  const [cardErrors, setCardErrors] = createSignal<Record<string, string>>({});
  let mounted = true;
  onCleanup(() => {
    mounted = false;
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const map = await fetchPatternImages();
      if (mounted) setImages(map);
    } catch (err) {
      if (mounted) {
        setError(err instanceof Error ? err.message : "Failed to load pattern images");
      }
    } finally {
      if (mounted) setLoading(false);
    }
  };

  const refresh = async () => {
    try {
      const map = await fetchPatternImages();
      if (mounted) setImages(map);
    } catch (err) {
      if (mounted) {
        setError(err instanceof Error ? err.message : "Failed to refresh pattern images");
      }
    }
  };

  onMount(() => {
    void load();
  });

  const handleUpload = async (patternId: string, file: File) => {
    setBusyId(patternId);
    setCardErrors((prev) => ({ ...prev, [patternId]: "" }));
    try {
      const result = await uploadPatternImage(patternId, file);
      setImages((prev) => (result.url ? { ...prev, [patternId]: result.url } : prev));
      showSuccess("Image uploaded", `${PATTERN_LABELS[patternId] ?? patternId} image updated`);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setCardErrors((prev) => ({ ...prev, [patternId]: message }));
      showError("Upload failed", message);
    } finally {
      if (mounted) setBusyId(null);
    }
  };

  const handleDelete = async (patternId: string) => {
    setBusyId(patternId);
    setCardErrors((prev) => ({ ...prev, [patternId]: "" }));
    try {
      await deletePatternImage(patternId);
      setImages((prev) => {
        const next = { ...prev };
        delete next[patternId];
        return next;
      });
      showSuccess("Image deleted", `${PATTERN_LABELS[patternId] ?? patternId} image removed`);
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete failed";
      setCardErrors((prev) => ({ ...prev, [patternId]: message }));
      showError("Delete failed", message);
    } finally {
      if (mounted) setBusyId(null);
    }
  };

  return (
    <Stack gap="sm" data-testid="pattern-image-manager">
      <Box>
        <Text size="md" fw={700}>
          Pattern images
        </Text>
        <Text size="sm" c="dimmed">
          Upload a square/landscape image per pattern; a placeholder shows until then
        </Text>
      </Box>

      <Show when={error()}>
        <Alert color="error" data-testid="pattern-image-manager-error">
          {error()}
        </Alert>
      </Show>

      <Show when={loading()} fallback={
        <SimpleGrid cols={cols()} spacing="sm" data-testid="pattern-image-manager-grid">
          <For each={PATTERN_CATALOG}>
            {(pattern) => {
              const hasImage = () => Boolean(images()[pattern.id]);
              const busy = () => busyId() === pattern.id;
              return (
                <Paper
                  p="sm"
                  radius="sm"
                  data-testid={`pattern-image-card-${pattern.id}`}
                  className="flex flex-col gap-2 border border-fin-border"
                >
                  <PatternImage patternId={pattern.id} images={images()} height={120} />
                  <Text size="sm" fw={600} truncate>
                    {pattern.name}
                  </Text>
                  <Group gap="xs" justify="space-between" align="center" wrap={false}>
                    <Button
                      size="xs"
                      variant="light"
                      component="label"
                      disabled={busy()}
                      leftSection={<IconUpload size={14} />}
                    >
                      {hasImage() ? "Replace" : "Upload"}
                      <input
                        type="file"
                        accept={ACCEPT}
                        disabled={busy()}
                        aria-label={`Upload image for ${pattern.name}`}
                        data-testid={`pattern-image-upload-${pattern.id}`}
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0];
                          e.currentTarget.value = "";
                          if (file) void handleUpload(pattern.id, file);
                        }}
                      />
                    </Button>
                    <button
                      type="button"
                      disabled={!hasImage() || busy()}
                      aria-label={`Delete image for ${pattern.name}`}
                      data-testid={`pattern-image-delete-${pattern.id}`}
                      onClick={() => void handleDelete(pattern.id)}
                      class="inline-flex size-7 items-center justify-center rounded text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <IconTrash size={15} />
                    </button>
                  </Group>
                  <Show when={cardErrors()[pattern.id]}>
                    <Text size="xs" c="error" data-testid={`pattern-image-error-${pattern.id}`}>
                      {cardErrors()[pattern.id]}
                    </Text>
                  </Show>
                </Paper>
              );
            }}
          </For>
        </SimpleGrid>
      }>
        <Group gap="sm" justify="center" py="md">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading pattern images...
          </Text>
        </Group>
      </Show>
    </Stack>
  );
}
