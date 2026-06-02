import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import babel from '@rollup/plugin-babel';
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
    // Declare globals used by bundled @hebcal/core and disable two rules that are
    // false positives in generated/bundled third-party code:
    //   constructor-super: @hebcal/core class hierarchy triggers this incorrectly.
    //   no-unexpected-multiline: license comments inserted by Terser cause this.
    footer: readFileSync('src/app.logic.js', 'utf8'),
  },
  plugins: [
    // Replace @hebcal/noaa (uses top-level await) with an empty stub.
    // We don't use Zmanim, so GeoLocation/NOAACalculator are never called.
    alias({
      entries: [
        { find: '@hebcal/noaa', replacement: pathResolve(__dirname, 'src/noaa-stub.js') },
      ],
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
          // Do NOT inject core-js polyfills — Espruino provides Map/Set/Promise natively.
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
    //   Reflect            referenced by Babel's wrapNativeSuper class helper.
    //   no-unexpected-multiline  license comments inserted by Terser.
    //   no-func-assign     preset-env helpers reassign hoisted function names.
    //   no-fallthrough     regenerator state-machine switch has no break/case.
    //   no-cond-assign     minified assignments inside conditionals.
    {
      name: 'prepend-eslint-directives',
      renderChunk(code) {
        const banner = '/* global Map, Set, Symbol, Intl, Temporal, Reflect */\n/* eslint-disable no-unexpected-multiline, no-func-assign, no-fallthrough, no-cond-assign */\n';
        return { code: banner + code, map: null };
      },
    },
  ],
  treeshake: { moduleSideEffects: false },
};
