import type { Env as EnvScholaris } from '../src/cloudflare/env.js';
declare global {
  namespace Cloudflare {
    interface Env extends EnvScholaris {}
  }
}
export {};
