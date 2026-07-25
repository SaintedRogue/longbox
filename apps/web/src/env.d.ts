/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
	readonly VITE_LONGBOX_SERVER_BASE_URL: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

/**
 * The git rev this bundle was built from, inlined by the `define` in `vite.config.ts` from the
 * `GIT_REV` build arg -- the same one the server's `env!("GIT_REV")` is compiled with.
 *
 * An empty string means the build was never stamped (every local `yarn build`), which the client
 * treats as "unknown" and never as "out of date".
 */
declare const __LONGBOX_BUILD_REV__: string
