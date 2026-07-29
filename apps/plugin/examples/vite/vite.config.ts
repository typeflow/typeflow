import { defineConfig } from 'vite';
import typeflow from '@typeflowjs/plugin/vite';

export default defineConfig({
  plugins: [typeflow()],
});
