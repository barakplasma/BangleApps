/**
 * Whitelist-style Espruino syntax compatibility check for the built app.js.
 *
 * The test collects the SET of every AST node type (and every operator) that
 * appears in the built bundle and asserts each is a member of the corresponding
 * APPROVED set. Anything not approved fails the test and is named in the
 * message — so a newly-introduced unsupported construct can never slip through
 * just because we forgot to forbid it.
 *
 * The APPROVED sets below are the AUTHORITATIVE, DOCUMENTED list of syntax
 * Espruino's interpreter accepts, transcribed from https://www.espruino.com/Features
 * (with the Espruino version each feature landed in). This doubles as a
 * reference: to relax transpilation, move a construct from the "EXCLUDED"
 * notes into the approved set and drop the corresponding transform — the build
 * output will still pass as long as it stays within documented support.
 *
 * Espruino implements the full ES5 grammar plus a hand-picked ES6 subset.
 * Anything outside these sets must be transpiled away by @babel/preset-env.
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

// ===========================================================================
// APPROVED SYNTAX — Espruino's documented support (espruino.com/Features).
// Babel AST naming: StringLiteral (not Literal), ObjectProperty (not Property).
// ===========================================================================

const APPROVED_NODE_TYPES = new Set([
  // ── Program structure ──────────────────────────────────────────────────
  'File', 'Program', 'Directive', 'DirectiveLiteral',

  // ── Identifiers & literals (ES5) ─────────────────────────────────────────
  'Identifier',
  'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral',
  'RegExpLiteral',          // basic regex since 1v95 (see operator caveats below)

  // ── Statements (ES5) ─────────────────────────────────────────────────────
  'ExpressionStatement', 'BlockStatement', 'EmptyStatement',
  'DebuggerStatement', 'ReturnStatement', 'BreakStatement',
  'ContinueStatement', 'IfStatement', 'SwitchStatement', 'SwitchCase',
  'ThrowStatement', 'TryStatement', 'CatchClause',   // optional catch binding: 2v20
  'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForInStatement',

  // ── Declarations (ES5 + let/const parsed since 2v14) ─────────────────────
  'VariableDeclaration', 'VariableDeclarator', 'FunctionDeclaration',

  // ── Expressions (ES5) ────────────────────────────────────────────────────
  'ArrayExpression', 'ObjectExpression', 'ObjectProperty',
  'FunctionExpression', 'UnaryExpression', 'UpdateExpression',
  'BinaryExpression', 'AssignmentExpression', 'LogicalExpression',
  'MemberExpression', 'ConditionalExpression', 'CallExpression',
  'NewExpression', 'SequenceExpression', 'ThisExpression',

  // ── ES6 features Espruino supports natively ──────────────────────────────
  'ArrowFunctionExpression',        // 1v88
  'TemplateLiteral', 'TemplateElement',  // 1v88 (raw strings NOT supported → no TaggedTemplateExpression)
  'ClassDeclaration', 'ClassExpression', 'ClassBody',
  'ClassMethod', 'Super',           // classes 1v96; class get/set 2v00; static 1v96
  'ObjectMethod',                   // object method shorthand 2v14; object get/set 2v00

  // ── Deliberately EXCLUDED (Espruino can NOT parse — must be transpiled) ───
  //   SpreadElement                array / call / object spread   [...x]
  //   RestElement                  rest params, rest in destructuring
  //   ArrayPattern / ObjectPattern destructuring targets
  //   AssignmentPattern            default parameters
  //   ForOfStatement               for...of            (not documented as supported)
  //   YieldExpression              generators / yield
  //   AwaitExpression              async / await
  //   OptionalMemberExpression,    optional chaining  ?.   (upstream PR, unreleased)
  //   OptionalCallExpression
  //   TaggedTemplateExpression     template raw strings not implemented
  //   ClassPrivateProperty,        private class fields  #x
  //   ClassPrivateMethod, StaticBlock
  //   LabeledStatement             labels not implemented
  //   WithStatement                `with` not implemented
]);

// Operator-level allowlists. These matter because some UNSUPPORTED operators
// share a node type with supported ones (e.g. `**` is a BinaryExpression,
// `||=` is an AssignmentExpression) — a node-type check alone would miss them.

const APPROVED_BINARY_OPERATORS = new Set([
  '==', '!=', '===', '!==', '<', '<=', '>', '>=',
  '<<', '>>', '>>>', '+', '-', '*', '/', '%',
  '|', '^', '&', 'in', 'instanceof',
  // EXCLUDED: '**' (exponentiation) — not implemented.
]);

const APPROVED_LOGICAL_OPERATORS = new Set([
  '&&', '||',
  '??',   // nullish coalescing: 2v14
]);

const APPROVED_ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=',
  '<<=', '>>=', '>>>=', '|=', '^=', '&=',
  // EXCLUDED: '**=' (exponentiation), '||=', '&&=', '??=' (logical assignment).
]);

const APPROVED_UNARY_OPERATORS = new Set([
  '-', '+', '!', '~', 'typeof', 'void', 'delete',
]);

const APPROVED_UPDATE_OPERATORS = new Set([
  '++', '--',
]);

// ===========================================================================

// Visit every node in the AST exactly once.
function forEachNode(node, cb) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') cb(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' ||
        key === 'type' || key === 'comments' || key === 'leadingComments' ||
        key === 'trailingComments' || key === 'innerComments' || key === 'tokens') {
      continue;
    }
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) forEachNode(c, cb);
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      forEachNode(child, cb);
    }
  }
}

const OPERATOR_RULES = {
  BinaryExpression:     APPROVED_BINARY_OPERATORS,
  LogicalExpression:    APPROVED_LOGICAL_OPERATORS,
  AssignmentExpression: APPROVED_ASSIGNMENT_OPERATORS,
  UnaryExpression:      APPROVED_UNARY_OPERATORS,
  UpdateExpression:     APPROVED_UPDATE_OPERATORS,
};

describe('app.js — Espruino syntax compatibility (whitelist)', () => {
  let usedNodeTypes;
  let disallowedOperators;

  beforeAll(() => {
    if (!existsSync(APP_JS_PATH)) {
      throw new Error('app.js not found — run `npm run build` first');
    }
    const code = readFileSync(APP_JS_PATH, 'utf8');
    // sourceType 'script': the output is an IIFE, not an ES module.
    const ast = parse(code, { sourceType: 'script' });

    usedNodeTypes = new Set();
    disallowedOperators = [];
    forEachNode(ast, (n) => {
      usedNodeTypes.add(n.type);
      const allowed = OPERATOR_RULES[n.type];
      if (allowed && typeof n.operator === 'string' && !allowed.has(n.operator)) {
        disallowedOperators.push(`${n.type}('${n.operator}')`);
      }
    });
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

  it('uses only operators Espruino can parse', () => {
    const unique = [...new Set(disallowedOperators)].sort();
    expect(
      unique,
      `app.js uses operators Espruino does not support: ${unique.join(', ')}. ` +
      `These share a node type with supported operators, so they must be ` +
      `transpiled (e.g. ** , **=, ||=, &&=, ??=).`,
    ).toEqual([]);
  });
});
