import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', simulator: 'scripts/simulator.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Workspace packages ship TypeScript source, so they must be bundled rather
  // than left as runtime imports.
  noExternal: [/^@wattnexa\//],
});
