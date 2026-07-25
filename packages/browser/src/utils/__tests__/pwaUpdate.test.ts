import {
	canApplyPendingUpdate,
	checkBuildRev,
	fetchServerBuildRev,
	isReaderPath,
	SERVER_VERSION_ROUTE,
} from '../pwaUpdate'

describe('isReaderPath', () => {
	it.each([
		'/books/1/reader',
		'/books/1/epub-reader',
		'/books/1/pdf-reader',
		'/books/1/reader/',
		'/downloads/book-1/read',
	])('treats %s as a reader route', (pathname) => {
		expect(isReaderPath(pathname)).toBe(true)
	})

	it('still matches when the app is served from a base path', () => {
		expect(isReaderPath('/longbox/books/1/reader')).toBe(true)
	})

	it.each([
		'/books/1',
		'/books/1/manage',
		'/books',
		'/libraries/1',
		'/downloads',
		'/series/1',
		'/',
	])('does not treat %s as a reader route', (pathname) => {
		expect(isReaderPath(pathname)).toBe(false)
	})
})

describe('canApplyPendingUpdate', () => {
	it('applies once the user navigates somewhere else', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/books/1',
				hasOpenDialog: false,
			}),
		).toBe(true)
	})

	it('never applies while the user is still on the same route', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/libraries/1',
				hasOpenDialog: false,
			}),
		).toBe(false)
	})

	it('never applies while a dialog is open, since a form may be in progress', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/libraries/1',
				current: '/books/1',
				hasOpenDialog: true,
			}),
		).toBe(false)
	})

	it('never reloads into a reader', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1',
				current: '/books/1/reader',
				hasOpenDialog: false,
			}),
		).toBe(false)
	})

	it('waits one more navigation when leaving a reader, so progress saves can land', () => {
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1/reader',
				current: '/books/1',
				hasOpenDialog: false,
			}),
		).toBe(false)

		// ...and applies on the navigation after that
		expect(
			canApplyPendingUpdate({
				armedOn: '/books/1',
				current: '/libraries/1',
				hasOpenDialog: false,
			}),
		).toBe(true)
	})
})

describe('checkBuildRev', () => {
	it('asks for an update check when the server is running a different build', async () => {
		const onMismatch = jest.fn()

		await checkBuildRev({
			buildRev: 'aaaa1111',
			fetchServerRev: () => Promise.resolve('bbbb2222'),
			onMismatch,
		})

		expect(onMismatch).toHaveBeenCalledTimes(1)
	})

	it('does nothing when both sides came out of the same build', async () => {
		const onMismatch = jest.fn()

		await checkBuildRev({
			buildRev: 'aaaa1111',
			fetchServerRev: () => Promise.resolve('aaaa1111'),
			onMismatch,
		})

		expect(onMismatch).not.toHaveBeenCalled()
	})

	// A local `yarn build` has no GIT_REV to stamp in, so the rev is empty. Comparing an empty rev
	// against a real one would make every dev build claim to be out of date.
	it.each([undefined, null, ''])(
		'never compares (or asks for the server rev) when the local rev is %p',
		async (buildRev) => {
			const onMismatch = jest.fn()
			const fetchServerRev = jest.fn().mockResolvedValue('bbbb2222')

			await checkBuildRev({ buildRev, fetchServerRev, onMismatch })

			expect(fetchServerRev).not.toHaveBeenCalled()
			expect(onMismatch).not.toHaveBeenCalled()
		},
	)

	it('stays quiet when the request fails, rather than guessing that we are stale', async () => {
		const onMismatch = jest.fn()

		await expect(
			checkBuildRev({
				buildRev: 'aaaa1111',
				fetchServerRev: () => Promise.reject(new Error('Network request failed')),
				onMismatch,
			}),
		).resolves.toBeUndefined()

		expect(onMismatch).not.toHaveBeenCalled()
	})

	it.each([undefined, null, ''])(
		'stays quiet when the server reports %p for its own rev',
		async (serverRev) => {
			const onMismatch = jest.fn()

			await checkBuildRev({
				buildRev: 'aaaa1111',
				fetchServerRev: () => Promise.resolve(serverRev),
				onMismatch,
			})

			expect(onMismatch).not.toHaveBeenCalled()
		},
	)
})

describe('fetchServerBuildRev', () => {
	const mockFetch = jest.fn()

	beforeEach(() => {
		mockFetch.mockReset()
		global.fetch = mockFetch as unknown as typeof fetch
	})

	const okResponse = (body: unknown) => ({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	})

	// The endpoint is a POST (see apps/server/src/routers/api/v2/mod.rs) and `LongboxVersion` is
	// serialized `rename_all = "camelCase"`, so `rev` arrives as `rev`.
	it('POSTs to the version route and reads the camelCase `rev` field', async () => {
		mockFetch.mockResolvedValue(
			okResponse({
				semver: '0.1.5',
				buildChannel: 'stable',
				rev: 'abc1234',
				compileTime: '2026-07-25',
			}),
		)

		await expect(fetchServerBuildRev('https://longbox.example')).resolves.toBe('abc1234')

		const [url, init] = mockFetch.mock.calls[0]
		expect(url).toBe(`https://longbox.example${SERVER_VERSION_ROUTE}`)
		expect(init).toEqual(expect.objectContaining({ method: 'POST' }))
	})

	it('does not double up the slash when the base URL has a trailing one', async () => {
		mockFetch.mockResolvedValue(okResponse({ rev: 'abc1234' }))

		await fetchServerBuildRev('https://longbox.example/')

		expect(mockFetch.mock.calls[0][0]).toBe(`https://longbox.example${SERVER_VERSION_ROUTE}`)
	})

	it('reports an unknown rev when the payload has no usable `rev`', async () => {
		mockFetch.mockResolvedValue(okResponse({ semver: '0.1.5' }))

		await expect(fetchServerBuildRev('https://longbox.example')).resolves.toBe('')
	})

	it('throws on a non-2xx so the caller treats it as unknown', async () => {
		mockFetch.mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) })

		await expect(fetchServerBuildRev('https://longbox.example')).rejects.toThrow('502')
	})

	// The end-to-end shape of "server unreachable": a rejected fetch must not reach `onMismatch`
	it('composes with checkBuildRev into a no-op when the server is unreachable', async () => {
		mockFetch.mockRejectedValue(new Error('Failed to fetch'))
		const onMismatch = jest.fn()

		await checkBuildRev({
			buildRev: 'aaaa1111',
			fetchServerRev: () => fetchServerBuildRev('https://longbox.example'),
			onMismatch,
		})

		expect(onMismatch).not.toHaveBeenCalled()
	})
})
