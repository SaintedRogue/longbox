/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
	readonly VITE_STUMP_SERVER_BASE_URL: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
