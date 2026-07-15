import { defineConfig } from 'vite';
import typeflow from '@typeflow/plugin/vite';

export default defineConfig({
  plugins: [typeflow()],
});
