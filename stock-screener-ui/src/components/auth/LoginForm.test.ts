import { describe, expect, test } from "vitest";
import { validateRegistration } from "./LoginForm";

describe("validateRegistration", () => {
  test("returns null for valid matching passwords", () => {
    expect(validateRegistration("password123", "password123")).toBeNull();
  });

  test("returns null for passwords of exactly 6 characters", () => {
    expect(validateRegistration("123456", "123456")).toBeNull();
  });

  test("returns error when passwords do not match", () => {
    expect(validateRegistration("password123", "different")).toBe("Passwords do not match");
  });

  test("returns error when passwords do not match even if long enough", () => {
    expect(validateRegistration("password123", "password456")).toBe("Passwords do not match");
  });

  test("returns password length error for short password", () => {
    expect(validateRegistration("12345", "12345")).toBe("Password must be at least 6 characters");
  });

  test("returns password length error for empty password", () => {
    expect(validateRegistration("", "")).toBe("Password must be at least 6 characters");
  });

  test("returns password mismatch error before length check", () => {
    const result = validateRegistration("12", "34");
    expect(result).toBe("Passwords do not match");
  });

  test("handles passwords with special characters", () => {
    expect(validateRegistration("p@ss!w0rd", "p@ss!w0rd")).toBeNull();
  });
});
