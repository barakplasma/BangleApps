import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
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
    alias({
      entries: [
        { find: '@hebcal/noaa', replacement: pathResolve(__dirname, 'src/noaa-stub.js') },
      ],
    }),
    resolve({ preferBuiltins: false }),
    commonjs(),
    terser({
      compress: { passes: 2, drop_console: true },
      mangle: true,
    }),
  ],
  treeshake: { moduleSideEffects: false },
};
