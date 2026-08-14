import { BookReaderSceneQuery } from '@longbox/graphql'

import { withResumePoint } from '../resumeCache'

const cached = (readProgress: unknown = null) =>
	({
		mediaById: {
			id: '1',
			resolvedName: 'Comic',
			pages: 20,
			extension: 'cbz',
			readProgress,
		},
	}) as unknown as BookReaderSceneQuery

const point = { page: 10, pages: 20, elapsedSeconds: 90 }

describe('withResumePoint', () => {
	it('records the page on an entry that had no progress yet -- the first-read case', () => {
		const patched = withResumePoint(cached(), point)
		expect(patched?.mediaById?.readProgress?.page).toBe(10)
		expect(patched?.mediaById?.readProgress?.elapsedSeconds).toBe(90)
	})

	it('overwrites the page an existing entry was opened at', () => {
		const patched = withResumePoint(
			cached({ page: 1, epubcfi: null, percentageCompleted: 0.05, elapsedSeconds: 5 }),
			point,
		)
		expect(patched?.mediaById?.readProgress?.page).toBe(10)
	})

	it('keeps the completion percentage coherent with the page', () => {
		expect(withResumePoint(cached(), point)?.mediaById?.readProgress?.percentageCompleted).toBe(0.5)
	})

	it('clamps the percentage at 1 for a page past the last one', () => {
		const patched = withResumePoint(cached(), { page: 25, pages: 20, elapsedSeconds: 0 })
		expect(patched?.mediaById?.readProgress?.percentageCompleted).toBe(1)
	})

	it('reports 0 rather than dividing by zero for a book with no pages', () => {
		const patched = withResumePoint(cached(), { page: 1, pages: 0, elapsedSeconds: 0 })
		expect(patched?.mediaById?.readProgress?.percentageCompleted).toBe(0)
	})

	it('preserves unrelated fields instead of replacing the entry', () => {
		const patched = withResumePoint(
			cached({ page: 1, epubcfi: 'epubcfi(/6/2)', percentageCompleted: 0.05, elapsedSeconds: 5 }),
			point,
		)
		expect(patched?.mediaById?.resolvedName).toBe('Comic')
		expect(patched?.mediaById?.readProgress?.epubcfi).toBe('epubcfi(/6/2)')
	})

	it('leaves an empty cache alone rather than inventing an entry', () => {
		expect(withResumePoint(undefined, point)).toBeUndefined()
		expect(withResumePoint({ mediaById: null } as BookReaderSceneQuery, point)).toEqual({
			mediaById: null,
		})
	})
})
