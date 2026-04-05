import { useState, useEffect } from "react";

export function useStoreSubscription(subscribe: (callback: () => void) => () => void): void {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      forceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [subscribe]);
}
