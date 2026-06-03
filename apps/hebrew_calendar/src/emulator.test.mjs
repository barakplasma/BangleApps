/**
 * Integration test: load app.js in a simulated Bangle.js 2 environment.
 *
 * Catches runtime errors that static analysis misses:
 *   - Missing built-ins (String.prototype.normalize, etc.)
 *   - Crashes during module initialization (locale setup, Map usage, etc.)
 *   - Layout / computeEvents failures after initialization
 */

import { readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { describe, it, expect } from 'vitest';
import SunCalc from 'suncalc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(__dirname, '../app.js');

// ---------------------------------------------------------------------------
// Bangle.js 2 / Espruino mock environment
// ---------------------------------------------------------------------------

const mockStorage = {
  readJSON(name) {
    if (name === 'mylocation.json') return { lat: 31.78, lon: 35.23 };
    if (name === 'hebrew_calendar.json') return { inIsrael: false };
    return null;
  },
};

let layoutTree = null;
let lastRendered = null;

function MockLayout(tree, opts) {
  layoutTree = tree;
  this._tree = tree;
  // Build a flat id→node map so app.logic can do layout.time.label = ...
  this._nodes = {};
  function walk(node) {
    if (node.id) this._nodes[node.id] = node;
    if (node.c) node.c.forEach(walk, this);
  }
  walk.call(this, tree);
  const self = this;
  Object.keys(this._nodes).forEach(id => { self[id] = self._nodes[id]; });
  this.render = function() { lastRendered = this._tree; };
}

const mockLocale = {
  time: (d) => d.toTimeString().substring(0, 5),
  date: (d) => d.toDateString(),
  dow: (d) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],
};

const mockSched = {
  setAlarm() {},
  reload() {},
};

const mockG = {
  clear() {},
  theme: { bg: 0, bg2: 0, bgH: 0 },
};

const mockBangle = {
  setUI() {},
  loadWidgets() {},
  drawWidgets() {},
};

// Stable "now" so tests are deterministic: 2024-04-10 (Wed) 12:00 UTC
const FIXED_NOW = new Date('2024-04-10T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW);
    else super(...args);
  }
  static now() { return FIXED_NOW.getTime(); }
}
// Keep static methods from native Date
Object.getOwnPropertyNames(Date).forEach(k => {
  if (!(k in FixedDate)) {
    try { FixedDate[k] = Date[k]; } catch (_) {}
  }
});

function buildContext() {
  const ctx = {
    // Espruino require
    require(mod) {
      if (mod === 'suncalc') return SunCalc;
      if (mod === 'Storage') return mockStorage;
      if (mod === 'Layout') return MockLayout;
      if (mod === 'locale') return mockLocale;
      if (mod === 'sched') return mockSched;
      throw new Error('Unknown require: ' + mod);
    },
    g: mockG,
    Bangle: mockBangle,
    setTimeout(fn, ms) { /* skip in tests */ return 1; },
    clearTimeout() {},
    setInterval(fn, ms) { return 1; },
    clearInterval() {},
    console: { log() {}, warn() {}, error() {} },
    // JS builtins — same set as APPROVED_GLOBALS in espruino-compat.test.mjs
    Object, Array, String, Number, Boolean,
    Error, TypeError, RangeError,
    Math, JSON,
    parseInt, parseFloat, isNaN, NaN, Infinity,
    // Set is NOT provided: it is injected as a plain-object stub by @rollup/plugin-inject,
    // so the bundle is self-contained and must not rely on a host Set global.
    Symbol,
    Int32Array,
    Date: FixedDate,
    undefined,
    // Espruino device globals (referenced but not called in init path)
    E: { setTimeZone() {}, getMemoryUsage() { return { free: 9999, usage: 1 }; } },
  };
  return createContext(ctx);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('emulator: app.js', () => {
  let appCode;
  try {
    appCode = readFileSync(APP_JS, 'utf8');
  } catch (e) {
    // If app.js hasn't been built yet, skip gracefully.
    appCode = null;
  }

  it('app.js exists (run npm run build first)', () => {
    expect(appCode).not.toBeNull();
  });

  it('loads without throwing in a mock Bangle.js 2 environment', () => {
    if (!appCode) return;
    const ctx = buildContext();
    expect(() => runInContext(appCode, ctx, { filename: 'app.js' })).not.toThrow();
  });

  it('HebCal IIFE exports HebrewCalendar, HDate, and flags', () => {
    if (!appCode) return;
    const ctx = buildContext();
    runInContext(appCode, ctx, { filename: 'app.js' });
    expect(ctx.HebCal).toBeDefined();
    expect(ctx.HebCal.HebrewCalendar).toBeDefined();
    expect(ctx.HebCal.HDate).toBeDefined();
    expect(ctx.HebCal.flags).toBeDefined();
  });

  it('computeEvents() returns a sorted array of events', () => {
    if (!appCode) return;
    const ctx = buildContext();
    runInContext(appCode, ctx, { filename: 'app.js' });
    // computeEvents is defined in app.logic.js (footer) which runs as part of the file.
    // hebrewCalendar global is populated by computeEvents() at init time.
    expect(Array.isArray(ctx.hebrewCalendar)).toBe(true);
    // Should have at least one event (Hebrew date label or holiday) in any 4-day window
    expect(ctx.hebrewCalendar.length).toBeGreaterThan(0);
    // Events should be sorted by startEvent
    for (let i = 1; i < ctx.hebrewCalendar.length; i++) {
      expect(ctx.hebrewCalendar[i].startEvent).toBeGreaterThanOrEqual(
        ctx.hebrewCalendar[i - 1].startEvent,
      );
    }
    // Each event should have desc (string), startEvent, endEvent (numbers)
    ctx.hebrewCalendar.forEach(ev => {
      expect(typeof ev.desc).toBe('string');
      expect(typeof ev.startEvent).toBe('number');
      expect(typeof ev.endEvent).toBe('number');
      expect(ev.endEvent).toBeGreaterThan(ev.startEvent);
    });
  });

  it('Layout was constructed and render() called during init', () => {
    if (!appCode) return;
    const ctx = buildContext();
    runInContext(appCode, ctx, { filename: 'app.js' });
    expect(layoutTree).not.toBeNull();
    expect(lastRendered).not.toBeNull();
  });
});
