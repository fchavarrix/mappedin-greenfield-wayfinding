import { defineConfig } from 'vite';

// Served from its own subdomain, so assets live at the root.
export default defineConfig({
  base: '/',
});
