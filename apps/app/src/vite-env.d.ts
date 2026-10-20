/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the public site, for links to the legal pages. */
  readonly VITE_SITE_URL?: string;
  readonly VITE_API_URL?: string;
}
