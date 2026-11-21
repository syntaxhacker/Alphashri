#!/usr/bin/env node
/**
 * Finds `.map()` calls whose callback returns JSX. Those rebuild the whole list
 * DOM on every parent update; `<For>` keeps each row alive and patches only
 * what changed. Data-building `.map()` calls (arrays for props, chart options,
 * Math.max arguments) are correct and are ignored.
 *
 * The regex approach cannot tell the two apart — a `data={xs.map(...)}` prop
 * looks identical to `{xs.map(...)}` — so this walks the real AST.
 *
 * Usage: node scripts/find-jsx-maps.mjs [path...]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import ts from "typescript";

const targets = process.argv.slice(2);
if (!targets.length) targets.push("src");

function walk(target, files = []) {
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(join(target, entry), files);
    }
    return files;
  }
  if ([".tsx", ".jsx"].includes(extname(target))) files.push(target);
  return files;
}

/** Does this subtree contain a JSX element/fragment that is *returned*? */
function returnsJsx(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** The callback body of `.map(fn)`, handling expression and block bodies. */
function mapCallback(call) {
  const fn = call.arguments[0];
  if (!fn) return null;
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) return fn;
  return null;
}

const hits = [];
for (const target of targets) {
  for (const file of walk(target)) {
    if (/\.test\.|\.stories\./.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node, kind) => {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      hits.push({ file: relative(process.cwd(), file), line: line + 1, kind });
    };
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "map"
      ) {
        const fn = mapCallback(node);
        if (fn) {
          const body = fn.body;
          const jsx = ts.isBlock(body) ? returnsJsx(body) : returnsJsx(body);
          if (jsx) {
            // Only flag when the result feeds JSX children, i.e. the map call
            // is itself an expression container child of a JSX element. A
            // `data={...}` / `series={...}` prop builds a value, not children.
            const parent = node.parent;
            const isJsxChild =
              parent &&
              (ts.isJsxExpression(parent) || ts.isParenthesizedExpression(parent) ||
                ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent));
            if (isJsxChild) report(node, "list");
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

console.log(`find-jsx-maps: ${hits.length} JSX-returning .map() site(s)`);
for (const hit of hits) console.log(`  ${hit.file}:${hit.line}`);
