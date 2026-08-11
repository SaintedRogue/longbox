import { MergeStrategy, MetadataProvider } from '@longbox/graphql'

import { createConfig, getPatchDefaults, patchConfig } from '../schema'

/**
 * Editing a saved provider used to be validated against the *create* schema, which requires
 * an API token. The server never returns a stored credential, so the field is always blank
 * on an edit -- meaning flipping the enable switch and saving failed on a key the system
 * already had. These pin the patch schema treating blank as "leave it alone".
 */

const PROVIDER = {
	id: 1,
	providerType: MetadataProvider.ComicVine,
	enabled: true,
	apiTokenExpiresAt: null,
	autoApplyConfig: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Parameters<typeof getPatchDefaults>[0]

describe('patchConfig', () => {
	it('accepts a change with no credential entered', () => {
		const result = patchConfig.safeParse({ enabled: false, apiToken: '' })
		expect(result.success).toBe(true)
	})

	/** Omitted, not empty — an empty string would overwrite the stored credential. */
	it('omits the token entirely when the field is blank', () => {
		const result = patchConfig.parse({ enabled: false, apiToken: '' })
		expect(result.apiToken).toBeUndefined()
		expect('apiToken' in JSON.parse(JSON.stringify(result))).toBe(false)
	})

	it('omits the token when it is null', () => {
		expect(patchConfig.parse({ enabled: true, apiToken: null }).apiToken).toBeUndefined()
	})

	it('keeps a token that was actually entered', () => {
		expect(patchConfig.parse({ apiToken: 'new-key' }).apiToken).toBe('new-key')
	})

	it('carries the enabled flag through', () => {
		expect(patchConfig.parse({ enabled: false }).enabled).toBe(false)
		expect(patchConfig.parse({ enabled: true }).enabled).toBe(true)
	})

	/** The defaults the edit dialog opens with must themselves pass validation. */
	it('accepts the defaults the edit form is seeded with', () => {
		const result = patchConfig.safeParse(getPatchDefaults(PROVIDER))
		expect(result.success).toBe(true)
	})

	it('still accepts an auto-apply change with no credential', () => {
		const defaults = getPatchDefaults(PROVIDER)
		const result = patchConfig.safeParse({
			...defaults,
			autoApplyConfig: { ...defaults.autoApplyConfig, enabled: true },
		})
		expect(result.success).toBe(true)
	})
})

describe('createConfig', () => {
	/** Creating still demands a credential — there is nothing stored to fall back on. */
	it('rejects a new provider with no token', () => {
		const result = createConfig.safeParse({
			providerType: MetadataProvider.ComicVine,
			enabled: true,
			apiToken: '',
			autoApplyConfig: {
				enabled: false,
				threshold: 0.95,
				strategy: MergeStrategy.FillGaps,
				excludeFields: [],
			},
		})
		expect(result.success).toBe(false)
	})
})
