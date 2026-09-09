#!/usr/bin/env node
// Opencode pre-tool hook: block destructive git commands
// Called with TOOL_INPUT env or first arg; exit 2 to block, 0 to allow

const input = process.env.TOOL_INPUT || process.argv.slice(2).join(" ") || "";
const cmd = input.toLowerCase();

// patterns to block
const blocked = [
  /git\s+reset\s+--hard/,
  /git\s+reset\s+--merge/,
  /git\s+clean\s+-fd/,
  /git\s+clean\s+.*-f.*d/,
  /git\s+checkout\s+--/,
  /git\s+restore\s+/,
  /git\s+branch\s+-D/,
  /git\s+push\s+--force/,
  /git\s+stash\s+(clear|drop)/,
];

for (const re of blocked) {
  if (re.test(cmd)) {
    console.error(`BLOCKED by .opencode/hooks/block-git-reset.js 🛡️ — "${cmd}" matches ${re}`);
    console.error("See stock-screener-ui/AGENTS.md: Agent Git Safety. Use small commits instead: git add -A && git commit -m \"wip: <task>\"");
    process.exit(2);
  }
}
process.exit(0);
