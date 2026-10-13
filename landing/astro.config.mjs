import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  // La landing se publica estática. Los instaladores (*.AppImage, *.deb, *.exe)
  // de la raíz del repo se copian a dist/ con `npm run build` + script de abajo.
  // Ver script/copiar-instaladores.mjs
  output: 'static',
});
