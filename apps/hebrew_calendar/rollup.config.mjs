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
    intro: 'if(!String.prototype.normalize)String.prototype.normalize=function(){return String(this);};',
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
    // Stub large @hebcal/core modules that are only used when their corresponding
    // CalOptions flags are set (sedrot, omer, molad, dailyLearning) — flags we never
    // pass.  The alias plugin only intercepts bare-specifier imports; these are
    // relative imports inside node_modules so we intercept them after resolution.
    // Stubbing saves ~40 KB in the bundle, critical for Bangle.js 2's ~64 KB JS heap.
    (function stubHebcalModules() {
      const stubs = {
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/sedra.js')]: pathResolve(__dirname, 'src/sedra-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/omer.js')]: pathResolve(__dirname, 'src/omer-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/DailyLearning.js')]: pathResolve(__dirname, 'src/dailylearning-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/molad.js')]: pathResolve(__dirname, 'src/molad-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/he.po.js')]: pathResolve(__dirname, 'src/he-po-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/he-x-NoNikud.po.js')]: pathResolve(__dirname, 'src/he-po-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/ashkenazi.po.js')]: pathResolve(__dirname, 'src/ashkenazi-po-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/hdate/dist/esm/he.po.js')]: pathResolve(__dirname, 'src/he-po-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/location.js')]: pathResolve(__dirname, 'src/location-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/MevarchimChodeshEvent.js')]: pathResolve(__dirname, 'src/mevarchim-stub.js'),
        [pathResolve(__dirname, 'node_modules/@hebcal/core/dist/esm/YomKippurKatanEvent.js')]: pathResolve(__dirname, 'src/yomkippurkatan-stub.js'),
      };
      return {
        name: 'stub-hebcal-modules',
        resolveId(id, importer) {
          if (!importer) return null;
          const resolved = pathResolve(dirname(importer), id);
          return stubs[resolved] || null;
        },
      };
    })(),
    // Replace the global Map constructor with a plain-object stub.
    // ES6 Map is valid syntax Espruino supports, but native Map subclassing
    // (via Reflect.construct) is unreliable, and all actual key types in
    // @hebcal/core and @hebcal/hdate are strings — a plain object covers them.
    // Exclude our own stubs to avoid circular self-injection.
    inject({
      Map: [pathResolve(__dirname, 'src/map-stub.js'), 'default'],
      exclude: ['**/map-stub.js', '**/quick-lru-stub.js', '**/noaa-stub.js',
                '**/sedra-stub.js', '**/omer-stub.js', '**/dailylearning-stub.js',
                '**/molad-stub.js', '**/he-po-stub.js', '**/ashkenazi-po-stub.js',
                '**/location-stub.js', '**/mevarchim-stub.js', '**/yomkippurkatan-stub.js'],
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
