/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the app, where buying and the wallet live. */
  readonly VITE_APP_URL?: string;
  /** The API, for account deletion on /eliminar-datos. Its origin joins connect-src in _headers. */
  readonly VITE_API_URL?: string;
}
