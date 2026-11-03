import { defineConfig } from 'vite';
import { esmExternalRequirePlugin } from 'rolldown/plugins';
export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'copyos-apps', cssFileName: 'copyos-apps' },
    rollupOptions: {
      plugins: [esmExternalRequirePlugin({ external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/] })],
    },
    minify: false,
  },
});
