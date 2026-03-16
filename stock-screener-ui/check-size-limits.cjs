// scripts/check-size-limits.cjs
// Enhanced: Color output, concise, high-priority issues first, shows biggest files needing refactor

const fs = require('fs');
const path = require('path');

// === CONFIGURABLE LIMITS ===
const FILE_LINE_LIMIT = 500;
const FILE_SIZE_LIMIT_KB = 100;
const FUNCTION_LINE_LIMIT = 50;
const TOP_N = 10; // Show top N biggest files

// ANSI color codes
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

// Directories to scan
const SRC_DIR = path.join(__dirname, 'src');

// Helper to get all JS/TS/JSX/TSX files recursively
function getAllSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllSourceFiles(filePath));
    } else if (/\.(js|jsx|ts|tsx)$/.test(file)) {
      results.push(filePath);
    }
  });
  return results;
}

// Check file size and line count
function checkFileLimits(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').length;
  const sizeKB = fs.statSync(filePath).size / 1024;
  let issues = [];
  if (lines > FILE_LINE_LIMIT) {
    const priority = lines > FILE_LINE_LIMIT * 2 ? `${RED}${BOLD}[HIGH]${RESET}` : `${YELLOW}[WARN]${RESET}`;
    issues.push({ priority: lines > FILE_LINE_LIMIT * 2 ? 1 : 2, msg: `${priority} ${BOLD}Lines:${RESET} ${lines} (limit ${FILE_LINE_LIMIT})` });
  }
  if (sizeKB > FILE_SIZE_LIMIT_KB) {
    const priority = sizeKB > FILE_SIZE_LIMIT_KB * 2 ? `${RED}${BOLD}[HIGH]${RESET}` : `${YELLOW}[WARN]${RESET}`;
    issues.push({ priority: sizeKB > FILE_SIZE_LIMIT_KB * 2 ? 1 : 2, msg: `${priority} ${BOLD}Size:${RESET} ${sizeKB.toFixed(1)}KB (limit ${FILE_SIZE_LIMIT_KB}KB)` });
  }
  return { issues, content, lines, sizeKB };
}

// Check function size using regex (simple, not perfect)
function checkFunctionLimits(content) {
  const functionRegex = /function\s+\w+\s*\([^)]*\)\s*{|\w+\s*=\s*\([^)]*\)\s*=>\s*{|\w+\s*:\s*function\s*\([^)]*\)\s*{/g;
  let match;
  let issues = [];
  while ((match = functionRegex.exec(content)) !== null) {
    const start = match.index;
    let braceCount = 0;
    let i = start;
    let inFunction = false;
    let lineStart = content.slice(0, start).split('\n').length;
    for (; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        inFunction = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (braceCount === 0 && inFunction) {
          let lineEnd = content.slice(0, i).split('\n').length;
          let funcLines = lineEnd - lineStart + 1;
          if (funcLines > FUNCTION_LINE_LIMIT) {
            const priority = funcLines > FUNCTION_LINE_LIMIT * 2 ? `${RED}${BOLD}[HIGH]${RESET}` : `${YELLOW}[WARN]${RESET}`;
            issues.push({
              priority: funcLines > FUNCTION_LINE_LIMIT * 2 ? 1 : 2,
              msg: `${priority} ${BOLD}Function@${lineStart}:${RESET} ${funcLines} lines (limit ${FUNCTION_LINE_LIMIT})`
            });
          }
          break;
        }
      }
    }
  }
  return issues;
}

// MAIN
function main() {
  const args = process.argv.slice(2);
  let files;
  
  if (args.length > 0) {
    files = args.filter(f => /\.(js|jsx|ts|tsx)$/.test(f) && fs.existsSync(f));
  } else {
    files = getAllSourceFiles(SRC_DIR);
  }
  
  let foundIssues = false;
  let hasHighPriority = false;
  let fileReports = [];
  let fileStats = [];

  files.forEach(file => {
    const relPath = file.replace(process.cwd() + '/', '');
    const { issues: fileIssues, content, lines, sizeKB } = checkFileLimits(file);
    const funcIssues = checkFunctionLimits(content);
    const allIssues = fileIssues.concat(funcIssues);
    if (allIssues.length) {
      foundIssues = true;
      const high = allIssues.some(i => i.priority === 1);
      if (high) hasHighPriority = true;
      fileReports.push({
        relPath,
        high,
        issues: allIssues
      });
    }
    fileStats.push({ relPath, lines, sizeKB });
  });

  // Sort files: high-priority first
  fileReports.sort((a, b) => {
    if (a.high && !b.high) return -1;
    if (!a.high && b.high) return 1;
    return a.relPath.localeCompare(b.relPath);
  });

  // Print issues: [HIGH] first, then [WARN]
  fileReports.forEach(report => {
    const color = report.high ? RED + BOLD : CYAN;
    console.log(`${color}${report.relPath}${RESET}`);
    report.issues
      .sort((a, b) => a.priority - b.priority)
      .forEach(issue => console.log('  ' + issue.msg));
  });

  if (!foundIssues) {
    console.log(`${GREEN}✅ All files and functions are within the specified limits.${RESET}`);
  } else {
    console.log(`\n${RED}${BOLD}Immediate attention: [HIGH] marked items should be refactored first.${RESET}`);
    console.log(`${YELLOW}Best practices: Split large files/components, keep functions focused and small, use hooks for logic reuse.${RESET}`);
  }

  if (args.length === 0) {
    const topLines = [...fileStats].sort((a, b) => b.lines - a.lines).slice(0, TOP_N);
    const topSize = [...fileStats].sort((a, b) => b.sizeKB - a.sizeKB).slice(0, TOP_N);

    console.log(`\n${BOLD}${CYAN}Top ${TOP_N} files by line count:${RESET}`);
    topLines.forEach(f => {
      console.log(`  ${f.relPath} - ${f.lines} lines`);
    });

    console.log(`\n${BOLD}${CYAN}Top ${TOP_N} files by size:${RESET}`);
    topSize.forEach(f => {
      console.log(`  ${f.relPath} - ${f.sizeKB.toFixed(1)}KB`);
    });
  }

  if (hasHighPriority) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}