/// <reference types="vite/client" />

/** Injected by vite.config.ts from package.json at build time. */
declare const __APP_VERSION__: string;

/** "owner/name" of the repository this build came from. See scripts/repo.mjs. */
declare const __REPO__: string;

declare module '*.png' {
  const src: string;
  export default src;
}
