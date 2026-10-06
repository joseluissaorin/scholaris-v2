import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { JWKS_PUBLICO } from './test/clave-prueba.js';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.prueba.jsonc' },
      miniflare: { bindings: { CLERK_JWKS: JWKS_PUBLICO } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
