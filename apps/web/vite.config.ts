import { constants as zlibConstants } from 'node:zlib'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'
import { defineConfig } from 'vite'
import { compression, defineAlgorithm } from 'vite-plugin-compression2'
import { VitePWA } from 'vite-plugin-pwa'
import tsconfigPaths from 'vite-plugin-tsconfig-paths'

// https://www.npmjs.com/package/vite-plugin-node-polyfills
import { name, version } from './package.json'

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		assetsDir: './assets',
		manifest: true,
		outDir: '../dist',
		rollupOptions: {
			output: {
				manualChunks: localeChunks,
			},
		},
	},
	clearScreen: false,
	define: {
		pkgJson: { name, version },
	},
	plugins: [
		tailwindcss(),
		react({
			babel: {
				plugins: [['babel-plugin-react-compiler', {}]],
			},
		}),
		tsconfigPaths(),
		compression({
			include: [/\.(js|mjs|json|css|html|svg|xml|wasm)$/i],
			exclude: [/\.(png|jpe?g|gif|webp|avif|woff2?|mp4|webm)$/i],
			threshold: 1024,
			algorithms: [
				defineAlgorithm('gzip', { level: 9 }),
				defineAlgorithm('brotliCompress', {
					params: {
						[zlibConstants.BROTLI_PARAM_QUALITY]: 11,
					},
				}),
			],
		}),
		VitePWA({
			// We register via the useRegisterSW hook (see PWAUpdatePrompt.tsx) so we can
			// surface an update-available toast instead of silently activating a new SW.
			injectRegister: null,
			registerType: 'prompt',
			// The png glob below already precaches the manifest icons (with real
			// revisions); the plugin's default of also adding them revisionless
			// creates conflicting duplicate entries that make workbox throw at SW
			// evaluation time — i.e. a service worker that never installs.
			includeManifestIcons: false,
			devOptions: {
				enabled: false,
			},
			workbox: {
				inlineWorkboxRuntime: true,
				globPatterns: [
					'**/*.{js,css,html,ico,png,svg}',
					'assets/longbox-splash.svg',
					'assets/fonts/inter/**/*.woff2',
				],
				// The 31 non-en-US translation chunks are ~100kB each (~3.2MB total). Precaching
				// them would hand every install the whole i18n catalogue again and undo the code
				// splitting entirely -- en-US is compiled into the app chunk and is precached with
				// it, so the fallback always works offline. The runtime cache below then keeps
				// whichever locale a user actually picked available offline after its first load.
				globIgnores: ['**/node_modules/**/*', 'assets/locale-*.js'],
				runtimeCaching: [
					{
						urlPattern: /\/assets\/locale-[^/]+\.js$/,
						handler: 'CacheFirst',
						options: {
							cacheName: 'longbox-locales',
							// Filenames are content-hashed, so a cached entry is never stale.
							expiration: {
								maxEntries: 8,
								maxAgeSeconds: 60 * 60 * 24 * 30,
							},
							cacheableResponse: {
								statuses: [0, 200],
							},
						},
					},
				],
				navigateFallbackDenylist: [
					/^\/api(?:\/|$)/,
					/^\/opds(?:\/|$)/,
					/^\/kobo(?:\/|$)/,
					/^\/koreader(?:\/|$)/,
				],
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, // 6MB
			},
			outDir: '../dist',
			base: '/',
			// TODO(pwa): Add more manifest definitions for better overall experience
			manifest: {
				id: 'longbox',
				name: 'Longbox',
				short_name: 'Longbox',
				description: 'A fast, self-hosted comics, manga, and digital book server.',
				theme_color: '#161719',
				// Brand ink — matches the app-icon tiles so the PWA launch/splash
				// background does not flash white before the UI paints.
				background_color: '#211d18',
				icons: [
					{
						src: '/assets/longbox-192.png',
						sizes: '192x192',
						type: 'image/png',
					},
					{
						src: '/assets/longbox-512.png',
						sizes: '512x512',
						type: 'image/png',
					},
					{
						src: '/assets/longbox-512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
			},
			manifestFilename: 'assets/manifest.webmanifest',
		}),
		reactFallbackThrottlePlugin(), // Leave empty for 0, or provide your own value if you like
		preloadPrimaryFontPlugin(),
	],
	publicDir: '../../../packages/browser/public',
	root: 'src',
	server: {
		port: 3000,
	},
})

/**
 * Give every lazily-imported translation file a predictable chunk name (`locale-de-DE`, ...).
 *
 * packages/i18n loads all non-en-US locales through `import()`, so rollup already splits them
 * out; naming them here is what makes them addressable by the service worker config above
 * (`globIgnores` / `runtimeCaching`) instead of hiding behind rollup's derived chunk names.
 *
 * en-US is deliberately *not* matched: it is statically imported as the i18next fallback and must
 * stay inside the app chunk so the very first render has translations without a network hop.
 */
function localeChunks(id: string): string | undefined {
	const [, locale] = /[\\/]i18n[\\/]src[\\/]locales[\\/]([\w-]+)\.json$/.exec(id) ?? []
	return locale && locale !== 'en-US' ? `locale-${locale}` : undefined
}

/**
 * The `@font-face` rules for Inter are pulled through the CSS pipeline (see
 * packages/components/src/styles/overrides.css), so Vite emits a content-hashed
 * copy of each woff2 — e.g. `assets/inter-latin-standard-normal-BwkfbSeq.woff2`.
 * That means a hardcoded `<link rel="preload">` in index.html can never point at
 * the file the CSS actually uses: it just downloads a second, unused copy of the
 * font (and steals preload priority from the one that is used).
 *
 * This plugin looks the real, hashed filename up in the output bundle and injects
 * the preload for it. Latin/standard/normal is the subset used to paint the UI on
 * a default (English) first load.
 */
function preloadPrimaryFontPlugin(
	fontPattern = /(^|\/)inter-latin-standard-normal-[\w-]+\.woff2$/,
) {
	let base = '/'

	return {
		name: 'vite-plugin-preload-primary-font',
		apply: 'build',
		enforce: 'post',
		configResolved(config: { base: string }) {
			base = config.base
		},
		transformIndexHtml: {
			order: 'post' as const,
			handler(_html: string, ctx: { bundle?: Record<string, unknown> }) {
				const fileName = Object.keys(ctx.bundle ?? {}).find((name) => fontPattern.test(name))

				// No match means the font is no longer bundled (or was renamed). Injecting
				// nothing is strictly better than injecting a preload that goes unused.
				if (!fileName) return

				return [
					{
						tag: 'link',
						attrs: {
							rel: 'preload',
							href: `${base}${fileName}`,
							as: 'font',
							type: 'font/woff2',
							crossorigin: true,
						},
						injectTo: 'head' as const,
					},
				]
			},
		},
	} satisfies PluginOption
}

// FIXME: This is actually fucking silly. I can't believe they hardcoded a 300ms throttle
// in React's source code with no way to override it. This plugin should be short term, I loved
// the DX of suspense but fuck if I'm dealing with this. Move off of it, I guess.
function reactFallbackThrottlePlugin(throttleMs = 0): {
	name: string
	transform: {
		filter: { id: { include: string[] } }
		handler: (src: string, id: string) => { code: string; map: null }
	}
} {
	return {
		name: 'vite-plugin-react-fallback-throttle',
		transform: {
			filter: {
				id: {
					include: [
						'**/react-dom-client.development.js',
						'**/react-dom-profiling.development.js',
						'**/react-dom-client.production.js',
						'**/react-dom*.js{?*,}',
						'**/react-dom*',
					],
				},
			},
			handler(src) {
				const srcWithReplacedFallbackThrottle = src
					// development
					.replace('FALLBACK_THROTTLE_MS = 300,', `FALLBACK_THROTTLE_MS = ${throttleMs},`)
					// production
					.replace(
						'((exitStatus = globalMostRecentFallbackTime + 300 - now())',
						`((exitStatus = globalMostRecentFallbackTime + ${throttleMs} - now())`,
					)
					.replace(
						'300 > now() - globalMostRecentFallbackTime)',
						`${throttleMs} > now() - globalMostRecentFallbackTime)`,
					)
					.replace(
						'(renderWasConcurrent = globalMostRecentFallbackTime + 300 - now())',
						`(renderWasConcurrent = globalMostRecentFallbackTime + ${throttleMs} - now())`,
					)

				const result = {
					code: srcWithReplacedFallbackThrottle,
					map: null,
				}

				return result
			},
		},
	} satisfies PluginOption
}
