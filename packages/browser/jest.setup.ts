import { deserialize, serialize } from 'node:v8'

import '@testing-library/jest-dom'
import 'cross-fetch/polyfill'
import './src/__mocks__/pointerCapture'

// jest-environment-jsdom's sandboxed global doesn't inherit Node's `structuredClone`.
// `fake-indexeddb` (used to test IndexedDB-backed modules, e.g. src/offline) relies on it
// internally for put/add; without it, the exception thrown inside the IDB event handler
// never rejects the wrapping promise, so the operation hangs instead of failing loudly.
// v8's serialize/deserialize round-trip is a close-enough structured-clone stand-in for tests.
if (typeof structuredClone === 'undefined') {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	;(globalThis as any).structuredClone = (value: unknown) => deserialize(serialize(value))
}
