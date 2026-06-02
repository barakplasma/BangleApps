import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import babel from '@rollup/plugin-babel';
import inject from '@rollup/plugin-inject';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve as pathResolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  input: 'src/hebcal-entry.js',
  output: {
    file: 'app.js',
    format: 'iife',
    name: 'HebCal',
    inlineDynamicImports: true,
    footer: readFileSync('src/app.logic.js', 'utf8'),
  },
  plugins: [
    // Replace @hebcal/noaa (uses top-level await) with an empty stub.
    // We don't use Zmanim, so GeoLocation/NOAACalculator are never called.
    // Replace quick-lru (extends Map + private fields + generators) with a
    // plain-object cache stub — Map subclassing and generators are not safe
    // on Espruino.
    alias({
      entries: [
        { find: '@hebcal/noaa', replacement: pathResolve(__dirname, 'src/noaa-stub.js') },
        { find: 'quick-lru', replacement: pathResolve(__dirname, 'src/quick-lru-stub.js') },
      ],
    }),
    // Replace the global Map constructor with a plain-object stub.
    // ES6 Map is valid syntax Espruino supports, but native Map subclassing
    // (via Reflect.construct) is unreliable, and all actual key types in
    // @hebcal/core and @hebcal/hdate are strings — a plain object covers them.
    // Exclude our own stubs to avoid circular self-injection.
    inject({
      Map: [pathResolve(__dirname, 'src/map-stub.js'), 'default'],
      exclude: ['**/map-stub.js', '**/quick-lru-stub.js', '**/noaa-stub.js'],
    }),
    resolve({ preferBuiltins: false }),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      presets: [
        ['@babel/preset-env', {
          // forceAllTransforms: transpile all ES6+ syntax to ES5 regardless of targets.
          // Espruino has no browserslist entry and lacks spread, destructuring, default
          // params, for-of — features no single real browser target would remove.
          forceAllTransforms: true,
          // Let Rollup own ES module syntax so tree-shaking and IIFE output still work.
          modules: false,
          // Smaller, simpler output; matches previous loose: true on class transforms.
          loose: true,
          // Do NOT inject core-js polyfills — Espruino provides Set/Promise natively.
        }],
      ],
      include: '**/node_modules/**',
    }),
    terser({
      compress: { passes: 2, drop_console: true },
      mangle: true,
      format: {
        comments: function(node, comment) {
          // Keep /*!...*/ and ESLint directive comments; strip everything else.
          return comment.type === 'comment2' &&
            (/^!/.test(comment.value) || /^\s*(global|eslint[\s-])/.test(comment.value));
        },
      },
    }),
    // Add ESLint directives AFTER terser so they are not stripped.
    // Declares globals and disables rules that are false positives in the
    // minified/transpiled bundle (the repo lints ./apps with --max-warnings 0):
    //   no-unexpected-multiline  license comments inserted by Terser.
    //   no-func-assign     preset-env helpers reassign hoisted function names.
    {
      name: 'prepend-eslint-directives',
      renderChunk(code) {
        const banner = '/* global Set, Symbol, Intl, Temporal */\n/* eslint-disable no-unexpected-multiline, no-func-assign */\n';
        return { code: banner + code, map: null };
      },
    },
  ],
  treeshake: { moduleSideEffects: false },
};
