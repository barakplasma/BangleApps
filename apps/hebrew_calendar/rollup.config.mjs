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
      plugins: [
        ['@babel/plugin-transform-class-properties', { loose: true }],
        ['@babel/plugin-transform-private-methods', { loose: true }],
        ['@babel/plugin-transform-spread'],
        ['@babel/plugin-transform-object-rest-spread'],
        ['@babel/plugin-transform-template-literals'],
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
    // Declares browser globals used by bundled @hebcal/core and disables two
    // false-positive rules in generated/third-party code.
    {
      name: 'prepend-eslint-directives',
      renderChunk(code) {
        const banner = '/* global Map, Set, Symbol, Intl, Temporal */\n/* eslint-disable constructor-super, no-unexpected-multiline */\n';
        return { code: banner + code, map: null };
      },
    },
  ],
  treeshake: { moduleSideEffects: false },
};
