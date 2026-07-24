import { JobStatus, JobUpdate } from '@longbox/graphql'
import deepEqual from 'deep-equal'
import { produce } from 'immer'
import { createWithEqualityFn } from 'zustand/traditional'

export type JobID = string

/**
 * How long a removed job's id is remembered in `recentlyRemovedJobIds` before it's pruned.
 * Must comfortably exceed the reconciliation poll interval (60s, see
 * `RECONCILE_INTERVAL_MS` in `useCoreEvent.ts`) so that a reconciliation request which was
 * already in flight when the job was removed can't outlive the guard and resurrect it.
 */
const RECENTLY_REMOVED_TTL_MS = 2 * 60 * 1000

/**
 * Mutates `recentlyRemovedJobIds` in place, dropping any entry older than
 * `RECENTLY_REMOVED_TTL_MS`. Called lazily from `removeJob` and `reconcileActiveJobs` instead
 * of on a timer, so there's nothing to schedule or tear down.
 */
const pruneExpiredRemovals = (recentlyRemovedJobIds: Record<JobID, number>, now: number) => {
	for (const [jobId, removedAt] of Object.entries(recentlyRemovedJobIds)) {
		if (now - removedAt > RECENTLY_REMOVED_TTL_MS) {
			delete recentlyRemovedJobIds[jobId]
		}
	}
}

type JobStore = {
	jobs: Record<JobID, JobUpdate>
	/**
	 * Ids of jobs removed via `removeJob`, mapped to the timestamp (`Date.now()`) they were
	 * removed at. Populated by `removeJob` itself (so every removal path is covered, not just
	 * the terminal-`JobUpdate` handler in `useCoreEvent.ts`) and consulted by
	 * `reconcileActiveJobs` to stop a stale reconciliation response from resurrecting a job
	 * that has since completed. Entries are pruned lazily -- see `pruneExpiredRemovals`.
	 */
	recentlyRemovedJobIds: Record<JobID, number>
	addJob: (id: JobID) => void
	upsertJob: (job: JobUpdate) => void
	removeJob: (jobId: JobID) => void
	/**
	 * Reconciles the locally-tracked active jobs against a fresh snapshot fetched from the
	 * server (e.g., on reconnect, or periodically to cover events dropped by a `Lagged`
	 * subscriber that never actually disconnected).
	 *
	 * A locally-tracked job is only removed if BOTH:
	 *  - its id was present in `knownJobIds`, a snapshot of the store's job ids taken
	 *    BEFORE the reconciliation request was sent, and
	 *  - it is absent from `activeJobs`, the fresh server-side list of active jobs.
	 *
	 * This guards against a race where a job starts (via a live event) while the
	 * reconciliation request is in flight: such a job's id would not be in `knownJobIds`,
	 * so it is never removed just because it's missing from the (now-stale) `activeJobs`
	 * response.
	 *
	 * Every job in `activeJobs` is upserted into the store: a minimal entry is created if
	 * not already known, otherwise only its `status` field is corrected -- other
	 * progress fields (e.g., `message`, `subtitle`) that are already known locally are
	 * left untouched, since the reconciliation response doesn't carry that detail.
	 *
	 * A job id present in `recentlyRemovedJobIds` is never (re-)upserted, even if it's in
	 * `activeJobs`. This guards against the mirror-image race: a job is `RUNNING` (and thus
	 * in `knownJobIds`) and still `RUNNING` per the server when the reconciliation request is
	 * built, then completes and is removed (via a live terminal `JobUpdate`) BEFORE the
	 * (now-stale) reconciliation response is applied. Without this guard, the response's
	 * upsert loop would see no existing job for that id and re-insert it as if still running,
	 * leaving it stuck in the store until the next reconciliation tick corrects it.
	 */
	reconcileActiveJobs: (
		activeJobs: Pick<JobUpdate, 'id' | 'status'>[],
		knownJobIds: JobID[],
	) => void
}

/**
 * A store for managing job updates from the SSE eventsource
 */
export const useJobStore = createWithEqualityFn<JobStore>(
	(set) => ({
		addJob: (id) =>
			set((state) =>
				produce(state, (draft) => {
					draft.jobs[id] = { id }
				}),
			),
		jobs: {} as Record<JobID, JobUpdate>,
		recentlyRemovedJobIds: {} as Record<JobID, number>,
		reconcileActiveJobs: (activeJobs, knownJobIds) =>
			set((state) =>
				produce(state, (draft) => {
					pruneExpiredRemovals(draft.recentlyRemovedJobIds, Date.now())

					const activeJobIds = new Set(activeJobs.map((job) => job.id))
					const knownJobIdSet = new Set(knownJobIds)

					for (const jobId of Object.keys(draft.jobs)) {
						if (knownJobIdSet.has(jobId) && !activeJobIds.has(jobId)) {
							delete draft.jobs[jobId]
						}
					}

					for (const activeJob of activeJobs) {
						if (activeJob.id in draft.recentlyRemovedJobIds) {
							continue
						}

						const existingJob = draft.jobs[activeJob.id]
						if (existingJob) {
							existingJob.status = activeJob.status
						} else {
							draft.jobs[activeJob.id] = { ...activeJob }
						}
					}
				}),
			),
		removeJob: (id) =>
			set((state) =>
				produce(state, (draft) => {
					delete draft.jobs[id]

					pruneExpiredRemovals(draft.recentlyRemovedJobIds, Date.now())
					draft.recentlyRemovedJobIds[id] = Date.now()
				}),
			),
		upsertJob: (job) => {
			set((state) =>
				produce(state, (draft) => {
					const existingJob = draft.jobs[job.id]
					if (existingJob) {
						// There are certain fields which are nullable from the update that we
						// absolutely do not want to overwrite with null. It behaves similar to
						// a patch request. The fields are: message, status, completedTasks, remainingTasks.
						// Subtasks are sent with both always included, so if they are null that means
						// they are completed and can be overwritten.
						const {
							status,
							completedTasks,
							remainingTasks,
							message,
							subtitle,
							completedSubtasks,
							totalSubtasks,
							...rest
						} = job

						// when the overall task position advances, the subtask state and subtitle from
						// the previous task get reset
						const taskTransition = completedTasks != null
						const subtaskState = taskTransition
							? { completedSubtasks: null, totalSubtasks: null }
							: {
									completedSubtasks: completedSubtasks ?? existingJob.completedSubtasks,
									totalSubtasks: totalSubtasks ?? existingJob.totalSubtasks,
								}

						draft.jobs[job.id] = {
							...existingJob,
							...rest,
							...subtaskState,
							completedTasks: completedTasks ?? existingJob.completedTasks,
							message: message ?? existingJob.message,
							remainingTasks: remainingTasks ?? existingJob.remainingTasks,
							status: status || existingJob.status,
							subtitle: taskTransition ? null : (subtitle ?? existingJob.subtitle),
						}
					} else {
						draft.jobs[job.id] = {
							...job,
							// This should be a safe assumption, as status events will always have a set status and
							// the only time other events are sent would be updates to the job itself
							status: job.status || JobStatus.Running,
						}
					}
				}),
			)
		},
	}),
	deepEqual,
)
