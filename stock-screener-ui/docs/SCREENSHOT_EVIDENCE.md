# Screenshot evidence for UI PRs

Required for every PR with user-visible UI changes.

## Capture

- Viewports: **1600×1000** and **390×844**.
- Every changed/new mode, selector option, empty state, loading state and error state.
- Use the live app, not a mocked screenshot, unless the state is impossible without a mock.
- Save under `stock-screener-ui/docs/screenshots/<feature>/<viewport>-<state>.png`.
- Keep files reasonably small (< 500 KB); prefer PNG. `reports/**` is gitignored, so do not put evidence there.

## Check before attaching

1. Open the PNG and read it. Do not claim a screenshot you have not looked at.
2. Reject blank canvases, `undefined`/`NaN`, clipped labels, overlapping controls, and tables clipped without an obvious scroll.
3. For a layout fit claim, include `getBoundingClientRect()` numbers for the panel/chart/table.
4. The chart canvas must have a real height (not 100px) and the table must own its vertical/horizontal scroll.

## Attach

Embed the images in the PR body or a PR comment with raw GitHub URLs:

```md
![Agri band 1600](https://raw.githubusercontent.com/<org>/<repo>/<branch>/stock-screener-ui/docs/screenshots/agri/desktop-band.png)
```

List each screenshot with its state and viewport. Refresh the images in the same commit as the UI change.
