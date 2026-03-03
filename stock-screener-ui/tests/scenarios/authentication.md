# Authentication & Authorization

Test scenarios for the Authentication & Authorization feature of the Alphashri Stock Screener application.

**Legend:**

- [x] = Test implemented and passing
- [ ] = Test not implemented
- [~] = Partially implemented / failing (needs investigation)
- N/A = Feature not yet implemented in app

---

## Test Scenarios

| Status | Scenario                                       | Test File      | Notes               |
| ------ | ---------------------------------------------- | -------------- | ------------------- |
| [x]    | Show login form when not authenticated         | auth.spec.ts   | Passing             |
| [x]    | Show register link on login form               | auth.spec.ts   | Passing             |
| [x]    | Login with valid credentials                   | auth.spec.ts   | Passing             |
| [x]    | Authenticated user can access protected routes | All test files | Via loginAsTestUser |
| [x]    | Show error with invalid credentials            | auth.spec.ts   | Passing             |
| [x]    | Validate email format                          | auth.spec.ts   | HTML5 validation    |
| [x]    | Require password field                         | auth.spec.ts   | HTML5 validation    |
| [x]    | Switch to register form                        | auth.spec.ts   | Passing             |
| [x]    | Register new user                              | auth.spec.ts   | Passing             |
| [x]    | Show user info in sidemenu                     | auth.spec.ts   | Passing             |
| [x]    | Logout when clicking sign out                  | auth.spec.ts   | Passing             |
| [x]    | Clear tokens on logout                         | auth.spec.ts   | Passing             |
| [x]    | Session persists on refresh                    | auth.spec.ts   | Passing             |
| [x]    | Redirect to login when token expired           | auth.spec.ts   | Passing             |

---

## Coverage Summary

| Category       | Passed | Total | Coverage |
| -------------- | ------ | ----- | -------- |
| Authentication | 14     | 14    | 100%     |

---

## Notes

- All authentication tests are passing
- HTML5 validation is used for email and password fields
- Session management includes token persistence and expiration handling
- Protected route access is verified via `loginAsTestUser` helper across all test files

---

_Last Updated: March 3, 2026_
