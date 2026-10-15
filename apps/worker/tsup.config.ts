import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Bundle our workspace packages (TypeScript source); keep node_modules external.
  skipNodeModulesBundle: true,
  noExternal: [/^@mm\//],
});
