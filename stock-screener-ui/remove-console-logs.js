#!/usr/bin/env node

/**
 * Remove all console.log statements from JS/TS files using Babel AST.
 *
 * Install dependencies:
 *   npm install @babel/parser @babel/traverse @babel/generator
 *
 * Note: For ESM, both @babel/traverse and @babel/generator require using .default if present.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import traverse from "@babel/traverse";
import { parse } from "@babel/parser";
import generator from "@babel/generator";

// For ESM interop: use .default if present
const traverseFn = traverse.default || traverse;
const generate = generator.default || generator;

// Process command line arguments
const args = process.argv.slice(2);
let targetPath = path.resolve(process.cwd(), "src");
let dryRun = false;
let explicitFiles = [];
let filesToProcess = 0;
let filesProcessed = 0;
let logsRemoved = 0;

// Parse arguments
args.forEach(arg => {
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (!arg.startsWith("--")) {
    explicitFiles.push(arg);
  }
});

// Function to check if a file is a JavaScript or TypeScript file
function isJsFile(file) {
  const ext = path.extname(file).toLowerCase();
  return [".js", ".jsx", ".ts", ".tsx"].includes(ext);
}

// Function to remove all console.log statements using Babel AST
function removeConsoleLogsFromCode(code) {
  let removedCount = 0;
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript"],
  });

  traverseFn(ast, {
    CallExpression(path) {
      const callee = path.get("callee");
      if (callee.matchesPattern("console.log") || callee.matchesPattern("console.warn")) {
        // Remove if it's a standalone statement
        if (path.parentPath.isExpressionStatement()) {
          path.parentPath.remove();
          removedCount++;
        }
        // Remove if inside JSXExpressionContainer: {console.log(...)}
        else if (
          path.parentPath.isJSXExpressionContainer &&
          path.parentPath.parentPath &&
          path.parentPath.parentPath.isJSXElement()
        ) {
          path.parentPath.remove();
          removedCount++;
        }
        // Replace with void 0 if used as an object property value
        else if (path.parentPath.isObjectProperty()) {
          path.replaceWithSourceString("void 0");
          removedCount++;
        }
      }
    },
  });

  return { code: generate(ast, {}, code).code, removedCount };
}

// Function to remove console.log statements from a file
async function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const { code: newContent, removedCount } = removeConsoleLogsFromCode(content);
    if (removedCount > 0) {
      logsRemoved += removedCount;
      if (!dryRun) {
        fs.writeFileSync(filePath, newContent);
      }
    }
    filesProcessed++;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

// Function to process all files in a directory recursively
async function processDirectory(directoryPath) {
  try {
    const files = fs.readdirSync(directoryPath);
    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        // Skip node_modules and hidden directories
        if (!file.startsWith(".") && file !== "node_modules") {
          await processDirectory(filePath);
        }
      } else if (stats.isFile() && isJsFile(file)) {
        filesToProcess++;
        await processFile(filePath);
      }
    }
  } catch (error) {
    console.error(`Error processing directory ${directoryPath}:`, error);
  }
}

// Function to process a single file
async function processSingleFile(filePath) {
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.isFile() && isJsFile(filePath)) {
      filesToProcess = 1;
      await processFile(filePath);
    } else {
      console.error(`${filePath} is not a JavaScript or TypeScript file.`);
    }
  } else {
    console.error(`File ${filePath} does not exist.`);
  }
}

// Main execution
async function main() {
  if (explicitFiles.length > 0) {
    for (const file of explicitFiles) {
      if (fs.existsSync(file) && isJsFile(file)) {
        filesToProcess++;
        await processFile(file);
      }
    }
  } else {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      await processDirectory(targetPath);
    } else if (stats.isFile()) {
      await processSingleFile(targetPath);
    }
  }
  if (logsRemoved > 0 && !dryRun) {
    console.log(`Removed ${logsRemoved} console.log/warn statements from ${filesProcessed} files.`);
  }
}

main().catch(error => {
  console.error("An error occurred:", error);
  process.exit(1);
});
