/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Your own Mapbox access token. Never commit a real one -- see .env.example. */
  readonly VITE_MAPBOX_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
