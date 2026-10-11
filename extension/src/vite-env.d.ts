interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_DATA_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
