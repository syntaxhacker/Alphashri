import "@testing-library/jest-dom/vitest";
import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

// Solid's testing library renders into a real root; unmount it between tests
// so signal subscriptions from one test cannot leak into the next.
afterEach(() => {
  cleanup();
});
