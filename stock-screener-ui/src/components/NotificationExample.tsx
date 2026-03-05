import { useNotifications } from "../hooks/useNotifications";

export function NotificationExample() {
  const { success, error, warning, info, clearAll } = useNotifications();

  const handleSuccess = () => {
    success("Bot created successfully!");
  };

  const handleError = () => {
    error("Failed to load bot: Invalid UUID");
  };

  const handleWarning = () => {
    warning("Market is closing in 15 minutes");
  };

  const handleInfo = () => {
    info("New strategy available for backtesting");
  };

  const handleCustomDuration = () => {
    error("This error will stay for 10 seconds", 10000);
  };

  const handleClearAll = () => {
    clearAll();
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Notification Examples</h2>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button onClick={handleSuccess}>Success</button>
        <button onClick={handleError}>Error</button>
        <button onClick={handleWarning}>Warning</button>
        <button onClick={handleInfo}>Info</button>
        <button onClick={handleCustomDuration}>Long Error (10s)</button>
        <button onClick={handleClearAll}>Clear All</button>
      </div>
    </div>
  );
}
