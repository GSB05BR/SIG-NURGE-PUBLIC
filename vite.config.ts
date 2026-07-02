import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config/
export default defineConfig({
  // Servido em https://<user>.github.io/SIG-NURGE-PUBLIC/ (GitHub Pages).
  // Ao publicar em outro caminho, ajuste `base` (ou use '/').
  base: '/SIG-NURGE-PUBLIC/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('/jspdf/') ||
            id.includes('/fflate/') ||
            id.includes('/fast-png/') ||
            id.includes('/canvg/') ||
            id.includes('/dompurify/') ||
            id.includes('/html2canvas/')
          ) {
            return 'pdf';
          }
          if (id.includes('/firebase/') || id.includes('/@firebase/')) {
            return 'firebase';
          }
          if (id.includes('/recharts/') || id.includes('/d3-')) {
            return 'charts';
          }
          if (id.includes('/lucide-react/')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
