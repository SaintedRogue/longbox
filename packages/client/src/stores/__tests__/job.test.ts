import { JobStatus } from '@longbox/graphql'

import { useJobStore } from '../job'

describe('useJobStore.reconcileActiveJobs', () => {
	beforeEach(() => {
		useJobStore.setState({ jobs: {}, recentlyRemovedJobIds: {} })
	})

	it('removes a job that was known before reconciliation and is absent from the fresh active list', () => {
		useJobStore.setState({
			jobs: {
				'job-1': { id: 'job-1', status: JobStatus.Running },
			},
		})
		const knownJobIds = Object.keys(useJobStore.getState().jobs)

		useJobStore.getState().reconcileActiveJobs([], knownJobIds)

		expect(useJobStore.getState().jobs['job-1']).toBeUndefined()
	})

	it('does not remove a job that started after the knownJobIds snapshot was taken, even if absent from the stale response', () => {
		// Simulate the snapshot being taken before the network request went out...
		const knownJobIds = Object.keys(useJobStore.getState().jobs)

		// ...then a live event adds a brand new job WHILE the reconciliation request is in flight.
		useJobStore.getState().addJob('job-new')

		// The (now-stale) reconciliation response doesn't know about `job-new`, but it must survive.
		useJobStore.getState().reconcileActiveJobs([], knownJobIds)

		expect(useJobStore.getState().jobs['job-new']).toBeDefined()
	})

	it('upserts jobs from the active list, creating a minimal entry when not already known', () => {
		useJobStore.getState().reconcileActiveJobs([{ id: 'job-2', status: JobStatus.Queued }], [])

		expect(useJobStore.getState().jobs['job-2']).toEqual({
			id: 'job-2',
			status: JobStatus.Queued,
		})
	})

	it('corrects only the status field of an already-known job, leaving other progress fields untouched', () => {
		useJobStore.setState({
			jobs: {
				'job-3': {
					id: 'job-3',
					status: JobStatus.Running,
					message: 'Scanning series',
					subtitle: '12/50',
				},
			},
		})
		const knownJobIds = Object.keys(useJobStore.getState().jobs)

		useJobStore
			.getState()
			.reconcileActiveJobs([{ id: 'job-3', status: JobStatus.Paused }], knownJobIds)

		expect(useJobStore.getState().jobs['job-3']).toEqual({
			id: 'job-3',
			status: JobStatus.Paused,
			message: 'Scanning series',
			subtitle: '12/50',
		})
	})

	it('does not resurrect a job that was removed (e.g. by a terminal JobUpdate live event) while a stale reconciliation response is in flight', () => {
		// Job `Y` is RUNNING and known before the reconciliation request goes out.
		useJobStore.setState({
			jobs: {
				'job-y': { id: 'job-y', status: JobStatus.Running },
			},
		})
		const knownJobIds = Object.keys(useJobStore.getState().jobs)

		// While the request is in flight, job `Y` actually completes and its terminal
		// JobUpdate live event arrives, removing it from the store.
		useJobStore.getState().removeJob('job-y')
		expect(useJobStore.getState().jobs['job-y']).toBeUndefined()

		// The (now-stale) reconciliation response still lists `Y` as active. Applying it
		// must NOT resurrect `Y` -- the deliberate removal is authoritative.
		useJobStore
			.getState()
			.reconcileActiveJobs([{ id: 'job-y', status: JobStatus.Running }], knownJobIds)

		expect(useJobStore.getState().jobs['job-y']).toBeUndefined()
	})

	it('still upserts other jobs from a stale reconciliation response even when one entry is guarded by a recent removal', () => {
		useJobStore.setState({
			jobs: {
				'job-y': { id: 'job-y', status: JobStatus.Running },
			},
		})
		const knownJobIds = Object.keys(useJobStore.getState().jobs)

		useJobStore.getState().removeJob('job-y')

		useJobStore.getState().reconcileActiveJobs(
			[
				{ id: 'job-y', status: JobStatus.Running },
				{ id: 'job-z', status: JobStatus.Queued },
			],
			knownJobIds,
		)

		expect(useJobStore.getState().jobs['job-y']).toBeUndefined()
		expect(useJobStore.getState().jobs['job-z']).toEqual({
			id: 'job-z',
			status: JobStatus.Queued,
		})
	})

	describe('recentlyRemovedJobIds TTL / pruning', () => {
		beforeEach(() => {
			jest.useFakeTimers()
		})

		afterEach(() => {
			jest.useRealTimers()
		})

		it('prunes an expired removal entry so it no longer guards a re-inserted job id', () => {
			jest.setSystemTime(0)
			useJobStore.setState({
				jobs: {
					'job-old': { id: 'job-old', status: JobStatus.Running },
				},
			})
			const knownJobIds = Object.keys(useJobStore.getState().jobs)

			useJobStore.getState().removeJob('job-old')
			expect(useJobStore.getState().recentlyRemovedJobIds['job-old']).toBe(0)

			// Advance well past the TTL (2 minutes) -- e.g. a brand new, unrelated job
			// happens to reuse the same id much later.
			jest.setSystemTime(10 * 60 * 1000)

			useJobStore
				.getState()
				.reconcileActiveJobs([{ id: 'job-old', status: JobStatus.Running }], knownJobIds)

			// The expired entry must have been pruned...
			expect(useJobStore.getState().recentlyRemovedJobIds['job-old']).toBeUndefined()
			// ...so the "new" job with the reused id is not incorrectly blocked.
			expect(useJobStore.getState().jobs['job-old']).toEqual({
				id: 'job-old',
				status: JobStatus.Running,
			})
		})

		it('prunes expired entries on removeJob so recentlyRemovedJobIds does not grow unbounded', () => {
			jest.setSystemTime(0)
			useJobStore.getState().addJob('job-a')
			useJobStore.getState().removeJob('job-a')
			expect(Object.keys(useJobStore.getState().recentlyRemovedJobIds)).toEqual(['job-a'])

			jest.setSystemTime(10 * 60 * 1000)
			useJobStore.getState().addJob('job-b')
			useJobStore.getState().removeJob('job-b')

			// `job-a`'s entry is long past its TTL and should have been pruned when `job-b`
			// was removed, leaving only the fresh entry behind.
			expect(Object.keys(useJobStore.getState().recentlyRemovedJobIds)).toEqual(['job-b'])
		})

		it('still guards against resurrection within the TTL window', () => {
			jest.setSystemTime(0)
			useJobStore.setState({
				jobs: {
					'job-y': { id: 'job-y', status: JobStatus.Running },
				},
			})
			const knownJobIds = Object.keys(useJobStore.getState().jobs)

			useJobStore.getState().removeJob('job-y')

			// Well within the TTL (e.g. the 60s reconciliation interval).
			jest.setSystemTime(30_000)

			useJobStore
				.getState()
				.reconcileActiveJobs([{ id: 'job-y', status: JobStatus.Running }], knownJobIds)

			expect(useJobStore.getState().jobs['job-y']).toBeUndefined()
		})
	})
})
