import { MetadataFetchStatus } from '@longbox/graphql'
import z from 'zod'

const scheduledScanConfig = z.object({
	libraryIds: z.array(z.string()),
})

const scheduledMetadataRetryConfig = z.object({
	statuses: z.array(z.nativeEnum(MetadataFetchStatus)),
})

const scheduledReleaseCalendarConfig = z.object({
	comicvineEnabled: z.boolean(),
	metronEnabled: z.boolean(),
	// Older stored configs predate LOCG, so this has to tolerate its absence.
	locgEnabled: z.boolean().optional(),
})

const scheduledJobConfig = z.union([
	scheduledScanConfig,
	scheduledMetadataRetryConfig,
	scheduledReleaseCalendarConfig,
])

export const parseScheduledJobConfig = (config: unknown) => {
	const result = scheduledJobConfig.safeParse(config)
	if (result.success) {
		return result.data
	}
	console.error('Failed to parse scheduled job config', result.error)
	return null
}

export type LibraryOption = { id: string; name: string; emoji?: string | null }

export const CRON_PRESETS = [
	{ localeKey: 'everySixHours', value: '0 0 */6 * * *' },
	{ localeKey: 'everyTwelveHours', value: '0 0 */12 * * *' },
	{ localeKey: 'dailyAtMidnight', value: '0 0 0 * * *' },
	{ localeKey: 'weeklySunday', value: '0 0 0 * * 0' },
	{ localeKey: 'monthlyFirst', value: '0 0 0 1 * *' },
] as const

export const RETRYABLE_STATUSES = [
	{ localeKey: 'rateLimited', value: MetadataFetchStatus.RateLimited },
	{ localeKey: 'failed', value: MetadataFetchStatus.Failed },
	// NO_MATCH entities are re-attempted too: file evidence or provider data may
	// have improved since the last pass, and the budget gate keeps retries cheap.
	{ localeKey: 'noMatch', value: MetadataFetchStatus.NoMatch },
] as const

export const KIND_OPTIONS = [
	{ localeKey: 'libraryScan', value: 'LIBRARY_SCAN' },
	{ localeKey: 'metadataRetry', value: 'METADATA_RETRY' },
	{ localeKey: 'releaseCalendarSync', value: 'RELEASE_CALENDAR_SYNC' },
] as const

export const scheduledJobFormSchema = z.object({
	name: z.string().min(1),
	schedule: z.string().min(1),
	kind: z.enum(['LIBRARY_SCAN', 'METADATA_RETRY', 'RELEASE_CALENDAR_SYNC']),
	libraryIds: z.array(z.string()).default([]),
	statuses: z
		.array(z.nativeEnum(MetadataFetchStatus))
		.min(1)
		.default([MetadataFetchStatus.RateLimited]),
	comicvineEnabled: z.boolean().default(true),
	metronEnabled: z.boolean().default(false),
	// Off by default: LOCG is an unofficial provider, so sweeping it is opt-in.
	locgEnabled: z.boolean().default(false),
	enabled: z.boolean().default(true),
})
export type ScheduledJobFormValues = z.infer<typeof scheduledJobFormSchema>

export function buildScheduledJobInput(values: ScheduledJobFormValues) {
	const config =
		values.kind === 'LIBRARY_SCAN'
			? { libraryScan: { libraryIds: values.libraryIds } }
			: values.kind === 'RELEASE_CALENDAR_SYNC'
				? {
						releaseCalendar: {
							comicvineEnabled: values.comicvineEnabled,
							metronEnabled: values.metronEnabled,
							locgEnabled: values.locgEnabled,
						},
					}
				: { metadataRetry: { statuses: values.statuses } }
	return { name: values.name, schedule: values.schedule, config, enabled: values.enabled }
}
