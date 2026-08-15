import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Tailwind 4 resolves colour utilities from the `@theme` block in
 * `packages/components/tailwind/preset.css`. A class naming a token that isn't defined there
 * is not an error — Tailwind simply emits nothing, the element renders unstyled, and it
 * looks like a design decision rather than a bug.
 *
 * That is exactly what happened: 51 usages across 21 files, half of them on the calendar
 * page, which is why it looked flat and unfinished. Nothing catches this at build time, so
 * it is caught here.
 *
 * Each entry is a token that has *never* existed, paired with the real one, so a failure
 * tells you what to write instead of just that you were wrong.
 */
const RETIRED_TOKENS: Record<string, string> = {
	'background-surface': 'muted',
	'background-surface-hover': 'muted',
	edge: 'border',
	'foreground-muted': 'muted-foreground',
	'foreground-subtle': 'muted-foreground',
}

/** Utility prefixes a colour token can follow. */
const PROPERTIES = [
	'bg',
	'text',
	'border',
	'ring',
	'from',
	'to',
	'via',
	'fill',
	'stroke',
	'divide',
	'outline',
].join('|')

const SOURCE_ROOTS = [resolve(__dirname, '..'), resolve(__dirname, '../../../components/src')]

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry)
		if (statSync(path).isDirectory()) {
			return entry === 'node_modules' || entry === 'dist' ? [] : sourceFiles(path)
		}
		return /\.tsx?$/.test(entry) ? [path] : []
	})
}

describe('design tokens', () => {
	const files = SOURCE_ROOTS.flatMap(sourceFiles)

	it('scans a plausible number of files', () => {
		// Guards the guard: a broken walk would make every assertion below vacuously pass.
		expect(files.length).toBeGreaterThan(100)
	})

	it.each(Object.entries(RETIRED_TOKENS))(
		'no source uses the non-existent token `%s` (use `%s`)',
		(dead, live) => {
			const pattern = new RegExp(`\\b(?:${PROPERTIES})-${dead}\\b`)
			const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')))

			expect(offenders.map((f) => f.replace(`${process.cwd()}/`, ''))).toEqual([])
			expect(live).toBeTruthy()
		},
	)

	/**
	 * `brand` on its own was never a colour — only the numbered `brand-50`…`brand-900` scale
	 * exists. The accent those usages wanted is `primary`.
	 */
	it('no source uses bare `brand` as a colour (use `primary`, or a `brand-N` step)', () => {
		const pattern = new RegExp(`\\b(?:${PROPERTIES})-brand\\b(?!-)`)
		const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')))

		expect(offenders.map((f) => f.replace(`${process.cwd()}/`, ''))).toEqual([])
	})
})
