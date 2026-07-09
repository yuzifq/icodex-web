import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/index.ts'],
  outDir: 'dist-cli',
  format: 'esm',
  target: 'node18',
  sourcemap: true,
  clean: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __codexCreateRequire } from "node:module";',
      'const require = __codexCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  noExternal: ['commander', 'express', 'ws'],
  external: ['node-pty', 'node-pty-prebuilt-multiarch', 'qrcode-terminal'],
})
