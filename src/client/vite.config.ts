import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const currentDir = dirname(fileURLToPath(import.meta.url));

function copyDefaultIcon() {
  return {
    name: 'copy-default-icon',
    apply: 'build',
    async writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? resolve(currentDir, '../../dist/client');
      const source = resolve(currentDir, '../../assets/default-icon.png');
      const destination = resolve(outDir, 'assets/default-icon.png');
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [copyDefaultIcon()],
  logLevel: 'warn',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        splash: 'splash.html',
        game: 'game.html',
        'post-create': 'post-create.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        sourcemapFileNames: '[name].js.map',
      },
    },
  },
});
