import { Text, Title } from "@/ui";

export function NiftyReportUnavailable() {
  return (
    <div
      data-testid="nifty-report-unavailable"
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        gap: "8px",
        padding: "16px",
        "text-align": "center",
      }}
    >
      <Title order={4} size="sm">
        Index Report is temporarily unavailable
      </Title>
      <Text size="xs" c="dimmed" style={{ "max-width": "56ch", "line-height": "1.4" }}>
        This desk is the last screen still written in React. Its child panels are Solid and expect
        accessor props, so the old component cannot mount in this app. It is disabled rather than left
        to crash while it is converted.
      </Text>
    </div>
  );
}
