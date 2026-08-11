import {
	CreateMetadataProviderConfigInput,
	ExistingProviderCardFragment,
	MergeStrategy,
	MetadataProvider,
	PatchMetadataProviderConfigInput,
} from '@longbox/graphql'
import z from 'zod'

const providerType = z.nativeEnum(MetadataProvider)
const mergeStrategy = z.nativeEnum(MergeStrategy)

const autoApplyConfig = z.object({
	enabled: z.boolean().default(false),
	threshold: z.number().min(0).max(1).default(0.95),
	strategy: mergeStrategy.default(MergeStrategy.FillGaps),
	excludeFields: z.array(z.string()).default([]),
})

export const createConfig = z
	.object({
		providerType,
		enabled: z.boolean().default(true),
		apiToken: z.string().min(1),
		apiTokenExpiresAt: z.date().nullish(),
		autoApplyConfig,
	})
	//  Note: I don't _think_ this has perf implications, but ensures the form
	// will stay in sync with CreateMetadataProviderConfigInput
	.transform((data) => data satisfies CreateMetadataProviderConfigInput)
export type CreateProviderConfigSchema = z.infer<typeof createConfig>

export const patchConfig = z
	.object({
		enabled: z.boolean().nullish(),
		/*
		 * Blank means "keep the credential you already have", not "set an empty one". The server
		 * never returns a stored token, so this field always renders empty on an edit; anything
		 * stricter turns changing an unrelated setting into re-typing an API key. Empty and null
		 * both collapse to `undefined` so the key is omitted from the patch entirely.
		 */
		apiToken: z
			.string()
			.nullish()
			.transform((value) => value || undefined),
		apiTokenExpiresAt: z.date().nullish(),
		autoApplyConfig: autoApplyConfig.nullish(),
	})
	.partial()
	// Note: I don't _think_ this has perf implications, but ensures the form
	// will stay in sync with PatchMetadataProviderConfigInput
	.transform((data) => data satisfies PatchMetadataProviderConfigInput)
export type PatchProviderConfigSchema = z.infer<typeof patchConfig>

export const getCommonDefaults = () => ({
	enabled: true,
	apiToken: '',
	apiTokenExpiresAt: null,
	autoApplyConfig: {
		enabled: false,
		threshold: 0.95,
		strategy: MergeStrategy.FillGaps,
		excludeFields: [],
	},
})

export const getPatchDefaults = (
	provider: ExistingProviderCardFragment,
): PatchProviderConfigSchema & { providerType: MetadataProvider } => ({
	enabled: provider.enabled,
	// Empty rather than null: this is what the password field actually holds while untouched,
	// and both mean "leave the stored credential alone".
	apiToken: '',
	apiTokenExpiresAt: provider.apiTokenExpiresAt,
	autoApplyConfig: {
		enabled: provider.autoApplyConfig?.enabled ?? false,
		threshold: provider.autoApplyConfig?.threshold ?? 0.95,
		strategy: provider.autoApplyConfig?.strategy ?? MergeStrategy.FillGaps,
		excludeFields: provider.autoApplyConfig?.excludeFields ?? [],
	},
	// Note: A bit lazy but adding here to inform the form the provider type and skip context etc
	providerType: provider.providerType,
})
