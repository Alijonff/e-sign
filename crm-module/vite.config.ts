import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = import.meta.dirname;
const signotecLib = readFileSync(resolve(here, '../web/public/vendor/STPadServerLib.js'), 'utf8');

// Сборка модуля в один файл: npm run build:module
export default defineConfig({
  root: here,
  publicDir: false,
  plugins: [react()],
  define: {
    __SIGNOTEC_LIB__: JSON.stringify(signotecLib),
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    lib: { entry: resolve(here, 'src/index.ts'), name: 'ESign', formats: ['iife'], fileName: () => 'esign-module.js' },
    outDir: resolve(here, '../web/public/crm-demo'),
    emptyOutDir: false,
    target: 'es2022',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
