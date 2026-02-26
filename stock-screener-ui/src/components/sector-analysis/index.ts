/**
 * Sector Analysis View
 *
 * Hosts the historical sector rotation dashboard from
 * /historical_sector_cycles as an embedded frame.
 */

const API_BASE = "http://localhost:8765";

export function renderSectorAnalysisView(): string {
  return `
    <div class="sector-analysis-view" data-testid="sector-analysis-view">
      <div class="sector-analysis-header">
        <div>
          <h2>Sector Analysis</h2>
          <p>Historical sector rotation dashboard (from historical_sector_cycles)</p>
        </div>
        <div class="sector-actions">
          <a class="btn btn-secondary btn-small" href="${API_BASE}/sector/usage.md" target="_blank" rel="noreferrer">Usage Guide</a>
          <a class="btn btn-primary btn-small" href="${API_BASE}/sector/dashboard-modular.html" target="_blank" rel="noreferrer">Open Fullscreen</a>
        </div>
      </div>

      <div class="sector-analysis-note">
        Optional: run <code>python historical_sector_cycles/sector_contributors_api.py</code> for volume endpoints on <code>:5555</code>.
      </div>

      <div class="sector-analysis-frame-wrap">
        <iframe
          class="sector-analysis-frame"
          src="${API_BASE}/sector/dashboard-modular.html"
          title="Sector Rotation Dashboard"
        ></iframe>
      </div>
    </div>
  `;
}
