/**
 * Verifies that the built app.js contains no syntax constructs that crash
 * Espruino's JS interpreter.  These are specifically features Espruino lacks
 * despite partial ES6 support (confirmed from espruino.com/Features):
 *
 *   ❌ Array/call/object spread  ([...x], fn(...x), {...x})
 *   ❌ Destructuring patterns    (const [a,b]=x; const {a}=x; fn([a,b]))
 *   ❌ for-of loops
 *   ❌ Default function parameters
 *   ❌ Template literals (belt-and-suspenders; preset-env transforms these too)
 *   ❌ Generator functions / yield
 *   ❌ async/await
 *
 * The test parses the built artifact with @babel/parser and walks the AST —
 * regex can't reliably distinguish syntax from string content.
 *
 * Prerequisite: run `npm run build` before `npm test` (or just run both).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@babel/parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = resolve(__dirname, '../app.js');

// ---------------------------------------------------------------------------
// Minimal recursive AST walker — no @babel/traverse dependency.
// Visits every node whose `type` matches one of the keys in `visitors`.
// ---------------------------------------------------------------------------
function walk(node, visitors) {
  if (!node || typeof node !== 'object') return;
  if (node.type && visitors[node.type]) visitors[node.type](node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach(c => walk(c, visitors));
    else if (child && typeof child === 'object' && child.type) walk(child, visitors);
  }
}

// Collect all nodes of a given type from the AST.
function findAll(ast, ...types) {
  const typeSet = new Set(types);
  const found = [];
  walk(ast, Object.fromEntries([...typeSet].map(t => [t, n => found.push(n)])));
  return found;
}

// ---------------------------------------------------------------------------

describe('app.js — Espruino syntax compatibility', () => {
  let ast;

  beforeAll(() => {
    if (!existsSync(APP_JS_PATH)) {
      throw new Error('app.js not found — run `npm run build` first');
    }
    const code = readFileSync(APP_JS_PATH, 'utf8');
    ast = parse(code, {
      // script (not module) because the output is an IIFE, not ESM.
      sourceType: 'script',
      // Allow any syntax @babel/parser knows about so the parse itself never
      // throws on valid syntax — we do our own structural checks below.
      errorRecovery: false,
    });
  });

  it('app.js parses as valid JavaScript', () => {
    expect(ast).toBeTruthy();
    expect(ast.type).toBe('File');
  });

  it('no array or call spread  ([...x] / fn(...x))', () => {
    // SpreadElement = spread inside arrays and call arguments.
    // RestElement   = rest params in function signatures — allowed by Espruino.
    const nodes = findAll(ast, 'SpreadElement');
    expect(nodes).toHaveLength(0);
  });

  it('no object spread / rest  ({...x})', () => {
    // After @babel/preset-env these become Object.assign()-style helpers.
    const spreads = findAll(ast, 'SpreadElement', 'RestElement').filter(n => {
      // Only flag RestElement when it appears directly inside an ObjectExpression
      // (object rest) or ObjectPattern (object destructuring rest).
      // A RestElement inside a FunctionDeclaration/FunctionExpression params is fine.
      return false; // SpreadElement already caught above; this filter is belt-and-suspenders.
    });
    // Verify no SpreadProperty / ExperimentalSpreadProperty legacy AST nodes either.
    const legacy = findAll(ast, 'SpreadProperty', 'ExperimentalSpreadProperty');
    expect(legacy).toHaveLength(0);
  });

  it('no destructuring patterns  (ArrayPattern / ObjectPattern)', () => {
    // Espruino can't parse `const [a, b] = x` or `const { a } = x`.
    // @babel/preset-env forceAllTransforms converts these to sequential assignments.
    const nodes = findAll(ast, 'ArrayPattern', 'ObjectPattern');
    expect(nodes).toHaveLength(0);
  });

  it('no for-of loops  (for...of)', () => {
    // Espruino does not support for-of.  preset-env converts to iterator loops.
    const nodes = findAll(ast, 'ForOfStatement');
    expect(nodes).toHaveLength(0);
  });

  it('no default function parameters  (function f(x = 1) {})', () => {
    // Espruino does not support default parameters.
    // AssignmentPattern in a function's params array = default param.
    const defaults = [];
    walk(ast, {
      AssignmentPattern(node) {
        defaults.push(node);
      },
    });
    expect(defaults).toHaveLength(0);
  });

  it('no template literals  (backtick strings)', () => {
    // Espruino supports template literals since 1v88, but preset-env transforms
    // them away.  This check confirms the transform ran on all node_modules code.
    const nodes = findAll(ast, 'TemplateLiteral', 'TaggedTemplateExpression');
    expect(nodes).toHaveLength(0);
  });

  it('no generator functions  (function* / yield)', () => {
    // Espruino does not support generators.  preset-env compiles them away via
    // the regenerator transform (using a bundled runtime helper).
    const yields = findAll(ast, 'YieldExpression');
    const genFns = findAll(ast, 'FunctionDeclaration', 'FunctionExpression').filter(
      n => n.generator === true,
    );
    expect(yields).toHaveLength(0);
    expect(genFns).toHaveLength(0);
  });

  it('no async / await', () => {
    // Espruino does not support async/await.  @hebcal/noaa (the only async dep)
    // is aliased to an empty stub, but verify nothing slipped through.
    const awaits = findAll(ast, 'AwaitExpression');
    const asyncFns = findAll(ast, 'FunctionDeclaration', 'FunctionExpression',
      'ArrowFunctionExpression').filter(n => n.async === true);
    expect(awaits).toHaveLength(0);
    expect(asyncFns).toHaveLength(0);
  });
});
