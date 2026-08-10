import { ProgressSpinner, Text } from '@longbox/components'
import { useEffect, useState } from 'react'

/** Seconds after which the wait stops looking normal and needs explaining. */
const SLOW_AFTER_SECONDS = 10
/** Seconds after which the user deserves to know this is still expected. */
const VERY_SLOW_AFTER_SECONDS = 30

const formatElapsed = (seconds: number) => {
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** Ticks once a second while `isActive`, resetting whenever a new run starts. */
function useElapsedSeconds(isActive: boolean) {
	const [elapsed, setElapsed] = useState(0)

	useEffect(() => {
		if (!isActive) {
			setElapsed(0)
			return
		}

		setElapsed(0)
		const interval = setInterval(() => setElapsed((value) => value + 1), 1000)
		return () => clearInterval(interval)
	}, [isActive])

	return elapsed
}

type Props = {
	/** Human-readable provider name, e.g. "Comic Vine". */
	providerLabel: string
}

/**
 * Progress for a provider search.
 *
 * These searches routinely run into the tens of seconds -- a 10s connect plus a
 * 30s request timeout, up to three retries, and ComicVine walks volumes before
 * issues -- and the previous UI was one line of static grey text. Nothing moved,
 * so a slow-but-working search was indistinguishable from a hung one.
 *
 * There is deliberately no progress *bar*: the server reports no percentage, and
 * inventing one would be a lie that makes the wait feel worse when it stalls at
 * 90%. What is honest, and what actually answers "is this thing alive", is a
 * moving spinner, a running clock, and copy that changes as the wait grows.
 *
 * There is also deliberately no Cancel: the SDK has no abort plumbing, so a
 * cancel button could only stop the UI waiting while the request continued
 * server-side. That would invite an immediate retry and double the load on a
 * rate-limited provider.
 */
export function SearchProgress({ providerLabel }: Props) {
	const elapsed = useElapsedSeconds(true)

	const message =
		elapsed >= VERY_SLOW_AFTER_SECONDS
			? 'Still working. Providers rate-limit and retry, so a slow reply is normal — not a failure.'
			: elapsed >= SLOW_AFTER_SECONDS
				? 'This can take up to a minute if the provider is slow to respond.'
				: null

	return (
		<div className="gap-4 py-8 flex flex-col items-center">
			<div className="gap-2.5 flex items-center">
				<ProgressSpinner size="sm" />
				<Text size="sm" variant="muted">
					Searching {providerLabel}…
				</Text>
				{/*
				 * The clock is the point -- it is what proves the search is alive. It is
				 * hidden from assistive tech because a per-second announcement would be
				 * unusable noise; the message below carries the same meaning in prose.
				 */}
				<Text size="sm" variant="muted" className="tabular-nums" aria-hidden>
					{formatElapsed(elapsed)}
				</Text>
			</div>

			{/* Only the phase changes are announced, not every tick. */}
			<div aria-live="polite" role="status" className="min-h-5">
				{message && (
					<Text size="xs" variant="muted" className="max-w-sm text-center">
						{message}
					</Text>
				)}
			</div>

			{/*
			 * Result-shaped placeholders so it is obvious where matches will land.
			 * `motion-safe` keeps the pulse out of the way for reduced-motion users.
			 */}
			<div className="gap-2 flex w-full flex-col" aria-hidden>
				{[0, 1, 2].map((row) => (
					<div
						key={row}
						className="h-16 motion-safe:animate-pulse bg-background-surface w-full rounded-md"
						style={{ animationDelay: `${row * 120}ms`, opacity: 1 - row * 0.25 }}
					/>
				))}
			</div>
		</div>
	)
}
