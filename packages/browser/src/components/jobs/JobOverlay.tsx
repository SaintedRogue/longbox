import { useFooterOffsetStore, useJobStore } from '@longbox/client'
import { IconButton, ProgressBar, Text } from '@longbox/components'
import { JobUpdate } from '@longbox/graphql'
import { AnimatePresence, motion } from 'framer-motion'
import { Minus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export default function JobOverlay() {
	const storeJobs = useJobStore((state) => state.jobs)
	const [isMinimized, setIsMinimized] = useState(false)

	/**
	 * All currently-running jobs, used to derive the minimized pill's count as well as the
	 * (first) job whose progress is displayed in the expanded panel.
	 */
	const runningJobs = useMemo(
		() => Object.values(storeJobs).filter((job) => job.status === 'RUNNING'),
		[storeJobs],
	)
	const hasRunningJobs = runningJobs.length > 0
	const firstRunningJob = runningJobs[0]

	/**
	 * The subtask counts for the job, which describe individual items being processed
	 */
	const subTaskCounts = useMemo(
		() => (firstRunningJob ? calcSubTaskCounts(firstRunningJob) : null),
		[firstRunningJob],
	)

	const progressValue = useMemo(() => {
		if (subTaskCounts != null && subTaskCounts.total > 0) {
			return (subTaskCounts.completed / subTaskCounts.total) * 100
		}
		return null
	}, [subTaskCounts])

	const subTaskCountString = useMemo(
		() => (subTaskCounts?.total ? `${subTaskCounts.completed ?? 0}/${subTaskCounts.total}` : null),
		[subTaskCounts],
	)

	const additionalOffset = useFooterOffsetStore((state) => state.footerOffset)

	/**
	 * Auto re-expand whenever the set of running jobs transitions from empty to non-empty, e.g.
	 * a new job kicks off after the user minimized the overlay for a previous, now-finished job.
	 * This runs in an effect (rather than during render) so it doesn't mutate state as a side
	 * effect of rendering, which the React Compiler disallows.
	 */
	const wasRunningRef = useRef(false)
	useEffect(() => {
		if (hasRunningJobs && !wasRunningRef.current) {
			setIsMinimized(false)
		}
		wasRunningRef.current = hasRunningJobs
	}, [hasRunningJobs])

	return (
		<AnimatePresence>
			{firstRunningJob &&
				(isMinimized ? (
					<motion.button
						// @ts-expect-error: It does have className actually?
						className="right-4 gap-2 px-4 py-2 shadow fixed z-50 flex items-center rounded-full border border-border bg-muted"
						initial={{ opacity: 0, scale: 0.9, y: 100 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.9, y: 100 }}
						style={{
							bottom: 16 + additionalOffset,
						}}
						onClick={() => setIsMinimized(false)}
						type="button"
					>
						<Text size="sm" className="font-medium whitespace-nowrap">
							{`Processing... ${runningJobs.length} ${runningJobs.length === 1 ? 'job' : 'jobs'}`}
						</Text>
						<ProgressBar
							value={progressValue}
							size="sm"
							variant="primary"
							isIndeterminate={progressValue == null}
							className="w-12"
						/>
					</motion.button>
				) : (
					<motion.div
						// @ts-expect-error: It does have className actually?
						className="right-4 w-72 h-28 p-4 shadow fixed relative z-50 flex flex-col items-start justify-between rounded-xl border border-border bg-muted"
						initial={{ opacity: 0, scale: 0.9, y: 100 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.9, y: 100 }}
						style={{
							bottom: 16 + additionalOffset,
						}}
					>
						<IconButton
							size="xxs"
							variant="ghost"
							className="right-2 top-2 absolute"
							onClick={() => setIsMinimized(true)}
							aria-label="Minimize job progress"
						>
							<Minus />
						</IconButton>

						<div className="pr-6 w-full">
							<Text size="sm" className="font-medium line-clamp-2">
								{firstRunningJob.message ?? 'Job in progress'}
							</Text>
							{firstRunningJob.subtitle && (
								<Text size="xs" className="line-clamp-1 text-muted-foreground">
									{firstRunningJob.subtitle}
								</Text>
							)}
						</div>

						<div className="gap-y-1.5 flex w-full flex-col">
							{subTaskCountString && (
								<Text size="xs" className="text-muted-foreground">
									{subTaskCountString}
								</Text>
							)}

							<ProgressBar
								value={progressValue}
								size="sm"
								variant="primary"
								isIndeterminate={progressValue == null}
							/>
						</div>
					</motion.div>
				))}
		</AnimatePresence>
	)
}

// TODO(cleanup): rename to calcTaskCounts once consolidated

const calcSubTaskCounts = ({ completedSubtasks, totalSubtasks }: JobUpdate) => {
	if (totalSubtasks == null) return null
	return {
		completed: completedSubtasks ?? 0,
		total: totalSubtasks,
	}
}
