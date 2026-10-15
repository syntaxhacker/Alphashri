import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
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
import { IconTrash, IconUpload } from "@tabler/icons-react";
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
  const cols = isWide ? 4 : isMid ? 3 : 2;

  const [images, setImages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const map = await fetchPatternImages();
      if (mounted.current) setImages(map);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Failed to load pattern images");
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const map = await fetchPatternImages();
      if (mounted.current) setImages(map);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Failed to refresh pattern images");
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const handleUpload = useCallback(
    async (patternId: string, file: File) => {
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
        if (mounted.current) setBusyId(null);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (patternId: string) => {
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
        if (mounted.current) setBusyId(null);
      }
    },
    [refresh],
  );

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

      {error ? (
        <Alert color="error" data-testid="pattern-image-manager-error">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Group gap="sm" justify="center" py="md">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading pattern images...
          </Text>
        </Group>
      ) : (
        <SimpleGrid cols={cols} spacing="sm" data-testid="pattern-image-manager-grid">
          {PATTERN_CATALOG.map((pattern) => {
            const hasImage = Boolean(images[pattern.id]);
            const busy = busyId === pattern.id;
            return (
              <Paper
                key={pattern.id}
                p="sm"
                radius="sm"
                data-testid={`pattern-image-card-${pattern.id}`}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <PatternImage patternId={pattern.id} images={images} height={120} />
                <Text size="sm" fw={600} truncate>
                  {pattern.name}
                </Text>
                <Group gap="xs" justify="space-between" align="center" wrap={false}>
                  <Button
                    size="xs"
                    variant="light"
                    component="label"
                    disabled={busy}
                    leftSection={<IconUpload size={14} />}
                  >
                    {hasImage ? "Replace" : "Upload"}
                    <input
                      type="file"
                      accept={ACCEPT}
                      disabled={busy}
                      aria-label={`Upload image for ${pattern.name}`}
                      data-testid={`pattern-image-upload-${pattern.id}`}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleUpload(pattern.id, file);
                      }}
                    />
                  </Button>
                  <ActionIcon
                    variant="subtle"
                    color="error"
                    size="sm"
                    disabled={!hasImage || busy}
                    aria-label={`Delete image for ${pattern.name}`}
                    data-testid={`pattern-image-delete-${pattern.id}`}
                    onClick={() => void handleDelete(pattern.id)}
                  >
                    <IconTrash size={15} />
                  </ActionIcon>
                </Group>
                {cardErrors[pattern.id] ? (
                  <Text size="xs" c="error" data-testid={`pattern-image-error-${pattern.id}`}>
                    {cardErrors[pattern.id]}
                  </Text>
                ) : null}
              </Paper>
            );
          })}
        </SimpleGrid>
      )}
    </Stack>
  );
}
