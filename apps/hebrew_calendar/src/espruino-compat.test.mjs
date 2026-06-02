/**
 * Whitelist-style Espruino syntax compatibility check for the built app.js.
 *
 * Rather than blacklisting known-bad constructs (which silently misses any new
 * unsupported feature), this test collects the SET of every AST node type that
 * actually appears in the built bundle and asserts that set is a subset of
 * APPROVED_NODE_TYPES — the node types Espruino's interpreter can parse.
 *
 * If a future dependency (or a build-config change) introduces a node type that
 * isn't on the approved list, the test fails and names the offending type(s),
 * forcing a deliberate decision: either Espruino genuinely supports it (add it
 * to the list, with a citation) or the build must transpile it away.
 *
 * The approved list is grounded in espruino.com/Features. Espruino implements
 * the full ES5 grammar plus a hand-picked subset of ES6. Everything NOT on the
 * list — spread, destructuring patterns, for-of, default params, generators,
 * async/await — is unsupported and must be removed by @babel/preset-env.
 *
 * Prerequisite: run `npm run build` before `npm test` (or run both).
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@babel/parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = resolve(__dirname, '../app.js');

// ---------------------------------------------------------------------------
// APPROVED_NODE_TYPES — Babel AST node types Espruino's parser accepts.
// Source: https://www.espruino.com/Features  (ES5 grammar + partial ES6).
// Babel-specific literal/property node names are used (StringLiteral, not
// Literal; ObjectProperty, not Property).
// ---------------------------------------------------------------------------
const APPROVED_NODE_TYPES = new Set([
  // ── Program structure ────────────────────────────────────────────────────
  'File', 'Program', 'Directive', 'DirectiveLiteral',

  // ── Identifiers & literals (ES5) ─────────────────────────────────────────
  'Identifier',
  'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral',
  'RegExpLiteral',

  // ── Statements (ES5) ─────────────────────────────────────────────────────
  'ExpressionStatement', 'BlockStatement', 'EmptyStatement',
  'DebuggerStatement', 'ReturnStatement', 'BreakStatement',
  'ContinueStatement', 'IfStatement', 'SwitchStatement', 'SwitchCase',
  'ThrowStatement', 'TryStatement', 'CatchClause', 'WhileStatement',
  'DoWhileStatement', 'ForStatement', 'ForInStatement', 'LabeledStatement',
  'WithStatement',

  // ── Declarations (ES5 + let/const, which Espruino parses since 2v14) ──────
  'VariableDeclaration', 'VariableDeclarator', 'FunctionDeclaration',

  // ── Expressions (ES5) ────────────────────────────────────────────────────
  'ArrayExpression', 'ObjectExpression', 'ObjectProperty', 'ObjectMethod',
  'FunctionExpression', 'UnaryExpression', 'UpdateExpression',
  'BinaryExpression', 'AssignmentExpression', 'LogicalExpression',
  'MemberExpression', 'ConditionalExpression', 'CallExpression',
  'NewExpression', 'SequenceExpression', 'ThisExpression',

  // ── ES6 features Espruino DOES support natively (espruino.com/Features) ───
  // Arrow functions (1v88), template literals (1v88), classes (1v96).
  // Listed so the test does not flag them if a future build leaves them
  // un-transpiled; Espruino can parse them.
  'ArrowFunctionExpression',
  'TemplateLiteral', 'TemplateElement', 'TaggedTemplateExpression',
  'ClassDeclaration', 'ClassExpression', 'ClassBody', 'ClassMethod',
  'Super',

  // NOTE: deliberately EXCLUDED (Espruino cannot parse these — must be
  // transpiled away by @babel/preset-env):
  //   SpreadElement                  array / call / object spread  [...x]
  //   ObjectPattern, ArrayPattern    destructuring targets
  //   AssignmentPattern              default params / destructuring defaults
  //   RestElement                    rest params / rest in destructuring
  //   ForOfStatement                 for...of
  //   YieldExpression                generators
  //   AwaitExpression                async/await
  //   OptionalMemberExpression,      optional chaining  ?.  (still in PR upstream)
  //   OptionalCallExpression
  //   ClassPrivateProperty,          private class fields  #x
  //   ClassPrivateMethod
]);

// ---------------------------------------------------------------------------
// Collect the set of all node types in the AST.
// ---------------------------------------------------------------------------
function collectNodeTypes(node, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (typeof node.type === 'string') acc.add(node.type);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' ||
        key === 'type' || key === 'comments' || key === 'leadingComments' ||
        key === 'trailingComments' || key === 'innerComments' || key === 'tokens') {
      continue;
    }
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) collectNodeTypes(c, acc);
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      collectNodeTypes(child, acc);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------

describe('app.js — Espruino syntax compatibility (whitelist)', () => {
  let usedNodeTypes;

  beforeAll(() => {
    if (!existsSync(APP_JS_PATH)) {
      throw new Error('app.js not found — run `npm run build` first');
    }
    const code = readFileSync(APP_JS_PATH, 'utf8');
    // sourceType 'script': the output is an IIFE, not an ES module.
    const ast = parse(code, { sourceType: 'script' });
    usedNodeTypes = collectNodeTypes(ast, new Set());
  });

  it('uses only AST node types Espruino can parse', () => {
    const disallowed = [...usedNodeTypes]
      .filter(t => !APPROVED_NODE_TYPES.has(t))
      .sort();

    expect(
      disallowed,
      `app.js contains AST node types not on the Espruino-approved whitelist: ` +
      `${disallowed.join(', ')}. Either @babel/preset-env must transpile these ` +
      `away, or — if Espruino genuinely supports them — add them to ` +
      `APPROVED_NODE_TYPES with a citation.`,
    ).toEqual([]);
  });
});
