/**
 * Whitelist-style Espruino compatibility check for the built app.js.
 *
 * Three complementary checks guard against different categories of breakage:
 *
 *  1. AST NODE TYPES — can Espruino's parser handle this syntax at all?
 *     Collects the set of every AST node type in the bundle and asserts each
 *     is in APPROVED_NODE_TYPES (grounded in espruino.com/Features).
 *     Catches: SpreadElement, ForOfStatement, destructuring, etc.
 *
 *  2. OPERATORS — same node type, unsupported operator?
 *     `**` and `||=` share a node type with supported operators, so a
 *     node-type check alone misses them. Operator-level allowlists close
 *     that gap.
 *
 *  3. GLOBAL IDENTIFIERS — does a referenced runtime API actually exist?
 *     Syntax can be 100 % valid ES5 while still calling `Reflect.construct`
 *     or `Proxy` — identifiers that Espruino does not provide. A pure
 *     node-type check is blind to this because `Identifier("Reflect")` is
 *     perfectly legal ES5 syntax. This check performs a scope-aware walk:
 *     it collects every identifier that appears in value position but is
 *     never declared anywhere in the bundle (i.e., must be a global), then
 *     asserts that set ⊆ APPROVED_GLOBALS.
 *
 *     This is the check that would have caught `Reflect` being pulled in by
 *     Babel's wrapNativeSuper helper (generated when a class extends a
 *     native like Map), which the previous two checks missed entirely.
 *
 * The APPROVED_* sets are the AUTHORITATIVE list of what Espruino supports,
 * sourced from https://www.espruino.com/Features. To relax a restriction,
 * add the construct to the appropriate approved set with a version citation;
 * the build output must still pass the remaining checks.
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
// CHECK 1 — APPROVED SYNTAX NODE TYPES
// Espruino's documented support (espruino.com/Features).
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

// ===========================================================================
// CHECK 2 — APPROVED OPERATORS
// Some unsupported operators share a node type with supported ones.
// e.g. `**` is a BinaryExpression; `||=` is an AssignmentExpression.
// A node-type check alone would miss them.
// ===========================================================================

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
// CHECK 3 — APPROVED GLOBAL IDENTIFIERS
//
// An identifier used in value position that is never declared anywhere in
// the bundle must be a global reference. If that global doesn't exist in
// Espruino the code will crash at runtime — even though the syntax is
// perfectly valid ES5 and the first two checks pass.
//
// Classic failure mode: Babel's wrapNativeSuper helper (generated when a
// class extends a native like Map) calls `Reflect.construct`. Every AST
// node — CallExpression, MemberExpression, Identifier("Reflect") — is on
// the syntax whitelist, so checks 1 and 2 cannot see the problem. Only a
// global-reference check catches it.
//
// ADDING TO THIS LIST: only add a global when espruino.com/Features
// explicitly documents it, with the firmware version it appeared in.
// Do NOT add globals Espruino lacks just to silence the test — fix the
// bundle instead (stub the dependency, see src/map-stub.js for the pattern).
//
// ── VERIFIED AGAINST ESPRUINO FIRMWARE FEATURES PAGE ─────────────────────
//
// ✅ IN BUNDLE AND APPROVED:
//   Object, Array, String, Number, Boolean, Date, Math, JSON    — ES5, all versions
//   Error, TypeError, RangeError                                — ES5, all versions
//   parseInt, parseFloat, isNaN, NaN                            — ES5, all versions
//   Int32Array                  — Typed Arrays: 1v80
//   Set                         — ES6 Set: 2v00
//   Symbol                      — 1v96 (with '@@iterator' string fallback)
//   Intl                        — Intl.DateTimeFormat: 2v22
//   Temporal                    — polyfilled by the app
//   Bangle, require             — Espruino / Bangle.js host API
//   setTimeout, clearTimeout    — Espruino host API
//   arguments                   — implicit in every function scope
//
// ❌ EXCLUDED — must NOT appear in bundle (fix the bundle if they appear):
//   Map         — replaced by plain-object stub (src/map-stub.js)
//   Reflect     — not in Espruino; was generated by Babel's wrapNativeSuper
//   Proxy       — not in Espruino
//   WeakMap, WeakSet, WeakRef, FinalizationRegistry — not in Espruino
//   globalThis  — not in Espruino
//   BigInt      — not in Espruino
//   structuredClone — not in Espruino
//
// ── SAFE TO ADD IF NEEDED — documented but not currently in bundle ────────
// The following are in Espruino's documented feature set and may safely be
// added if a future dependency requires them. Do NOT add them preemptively.
//   Promise     — 2v00 (not currently used — no async in runtime path)
//   Function    — ES5 (not currently referenced as a global constructor)
//   RegExp      — ES5 (regex literals used but not `new RegExp()`)
//   SyntaxError, ReferenceError, EvalError, URIError — ES5 errors, not in bundle
//   encodeURI, decodeURI, encodeURIComponent, decodeURIComponent — ES5, not in bundle
//   undefined, Infinity         — ES5, terser replaces with `void 0` / numerics
//   Uint8Array … Float64Array   — Typed Arrays 1v80, not currently in bundle
//   setInterval, clearInterval  — Espruino host, not currently in bundle
//   g, E, NRF                   — Espruino / Bangle.js host, not currently in bundle
// ===========================================================================

const APPROVED_GLOBALS = new Set([
  // ── ES5 built-ins present in the bundle ──────────────────────────────────
  'Object', 'Array', 'String', 'Number', 'Boolean',
  'Error', 'TypeError', 'RangeError',
  'Math', 'Date', 'JSON',
  'parseInt', 'parseFloat', 'isNaN',
  'NaN',

  // ── Typed arrays — Espruino 1v80 ─────────────────────────────────────────
  // Only Int32Array appears in the current bundle (@hebcal/hdate year cache).
  // Other typed arrays are listed as safe-to-add above but not pre-approved.
  'Int32Array',

  // ── Timer functions — Espruino host API ──────────────────────────────────
  'setTimeout', 'clearTimeout',

  // ── Espruino-documented ES6+ globals ─────────────────────────────────────
  // Set is intentionally absent: injected as a plain-object stub via @rollup/plugin-inject,
  // so no host Set global is needed.
  'Symbol',  // 1v96 — used as Symbol.iterator / Symbol.toStringTag with '@@' fallback
  'Intl',    // Intl.DateTimeFormat: 2v22 — timezone-aware candle-lighting times

  // ── Polyfilled by the app before the bundle runs ──────────────────────────
  'Temporal', // @hebcal/core uses Temporal.ZonedDateTime / PlainDate for molad

  // ── Bangle.js / Espruino host API ─────────────────────────────────────────
  'Bangle',   // Espruino Bangle global — watch hardware events and display
  'require',  // Espruino module loader

  // ── Implicit in every function scope ─────────────────────────────────────
  'arguments',

  // ── Bangle.js / Espruino host API ─────────────────────────────────────────
  'Bangle', 'g', 'E', 'NRF',
  'require', // Espruino module loader

  // ── Implicit in every function scope (not a true global, but never declared) ──
  'arguments',
]);

// ===========================================================================
// AST WALKERS
// ===========================================================================

// Simple visitor: calls cb(node) for every node in document order.
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

// Scope-aware walk: collects every identifier that is referenced as a value
// but never declared anywhere in the bundle. Those are global references.
//
// "Declared" means: VariableDeclarator id, FunctionDeclaration/Expression id,
// function/arrow parameters, or CatchClause parameter.
//
// "Referenced" means: an Identifier appearing in value position, i.e. NOT as
// a non-computed MemberExpression property (obj.PROP) and NOT as a
// non-computed ObjectProperty key ({KEY: v}).
//
// Because terser renames every local variable to a short identifier (usually
// 1-2 chars), any multi-character name that survives in the minified bundle
// is almost certainly a real global — but the scope-tracking approach is
// exact and needs no such heuristic.
function collectGlobalRefs(ast) {
  const declared = new Set();
  const referenced = new Set();

  // Record a node as a declaration target (handles Identifier nodes only;
  // destructuring patterns are transpiled away by the time we see this bundle).
  function addDecl(node) {
    if (!node) return;
    if (node.type === 'Identifier') { declared.add(node.name); return; }
    // Gracefully handle patterns that shouldn't appear (forceAllTransforms
    // removes them, but be defensive):
    if (node.type === 'RestElement') { addDecl(node.argument); return; }
    if (node.type === 'AssignmentPattern') { addDecl(node.left); return; }
  }

  const SKIP_KEYS = new Set([
    'type', 'loc', 'start', 'end', 'range', 'comments',
    'leadingComments', 'trailingComments', 'innerComments', 'tokens',
  ]);

  function walk(node) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

    switch (node.type) {
      case 'Identifier':
        // An Identifier reached here is in value/reference position.
        referenced.add(node.name);
        break;

      case 'VariableDeclarator':
        // Left side is a declaration; right side is a value.
        addDecl(node.id);
        walk(node.init);
        break;

      case 'FunctionDeclaration':
      case 'FunctionExpression':
        // Function name and parameters are declarations.
        if (node.id) addDecl(node.id);
        (node.params || []).forEach(addDecl);
        walk(node.body);
        break;

      case 'ArrowFunctionExpression':
        (node.params || []).forEach(addDecl);
        walk(node.body);
        break;

      case 'CatchClause':
        if (node.param) addDecl(node.param);
        walk(node.body);
        break;

      case 'MemberExpression':
        // obj.PROP — only obj is a value reference; PROP is a name, not a reference.
        // obj[expr] — both are references.
        walk(node.object);
        if (node.computed) walk(node.property);
        break;

      case 'ObjectProperty':
        // { KEY: value } — KEY is a name when not computed.
        if (node.computed) walk(node.key);
        walk(node.value);
        break;

      case 'ObjectMethod':
      case 'ClassMethod':
        if (node.computed) walk(node.key);
        (node.params || []).forEach(addDecl);
        walk(node.body);
        break;

      default: {
        for (const [k, v] of Object.entries(node)) {
          if (SKIP_KEYS.has(k)) continue;
          if (Array.isArray(v)) {
            for (const c of v) {
              if (c && typeof c === 'object' && typeof c.type === 'string') walk(c);
            }
          } else if (v && typeof v === 'object' && typeof v.type === 'string') {
            walk(v);
          }
        }
      }
    }
  }

  walk(ast);
  // Anything referenced but not declared anywhere in the bundle is a global.
  return new Set([...referenced].filter(n => !declared.has(n)));
}

// ===========================================================================

const OPERATOR_RULES = {
  BinaryExpression:     APPROVED_BINARY_OPERATORS,
  LogicalExpression:    APPROVED_LOGICAL_OPERATORS,
  AssignmentExpression: APPROVED_ASSIGNMENT_OPERATORS,
  UnaryExpression:      APPROVED_UNARY_OPERATORS,
  UpdateExpression:     APPROVED_UPDATE_OPERATORS,
};

describe('app.js — Espruino compatibility (whitelist)', () => {
  let ast;
  let usedNodeTypes;
  let disallowedOperators;
  let globalRefs;

  beforeAll(() => {
    if (!existsSync(APP_JS_PATH)) {
      throw new Error('app.js not found — run `npm run build` first');
    }
    const code = readFileSync(APP_JS_PATH, 'utf8');
    // sourceType 'script': the output is an IIFE, not an ES module.
    ast = parse(code, { sourceType: 'script' });

    usedNodeTypes = new Set();
    disallowedOperators = [];
    forEachNode(ast, (n) => {
      usedNodeTypes.add(n.type);
      const allowed = OPERATOR_RULES[n.type];
      if (allowed && typeof n.operator === 'string' && !allowed.has(n.operator)) {
        disallowedOperators.push(`${n.type}('${n.operator}')`);
      }
    });

    globalRefs = collectGlobalRefs(ast);
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

  it('references only global identifiers Espruino provides at runtime', () => {
    const disallowed = [...globalRefs]
      .filter(g => !APPROVED_GLOBALS.has(g))
      .sort();

    expect(
      disallowed,
      `app.js references global identifiers Espruino does not provide: ` +
      `${disallowed.join(', ')}. This check catches runtime APIs (like Reflect, ` +
      `Proxy, WeakMap) that are valid ES5 syntax but absent from Espruino. ` +
      `Either remove the dependency that introduces the global, stub it out ` +
      `(see src/quick-lru-stub.js for the pattern), or — only if Espruino ` +
      `genuinely provides it — add it to APPROVED_GLOBALS with a version citation.`,
    ).toEqual([]);
  });
});
