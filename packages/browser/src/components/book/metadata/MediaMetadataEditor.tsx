import { zodResolver } from '@hookform/resolvers/zod'
import { useGraphQLMutation, useSDK } from '@longbox/client'
import { CheckBox, Label, Text } from '@longbox/components'
import { FragmentType, graphql, MetadataField, useFragment, UserPermission } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { ColumnDef, createColumnHelper } from '@tanstack/react-table'
import getProperty from 'lodash/get'
import { useCallback, useMemo, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { match, P } from 'ts-pattern'

import {
	BadgeCell,
	BadgeListCell,
	isEmptyField,
	LockFieldButton,
	MediaMetadataEditorRow,
	MediaMetadataKeys,
	MetadataEditorContext,
	MetadataEditorHeader,
	MetadataEditorState,
	MetadataEditorTable,
	NumberCell,
	TextCell,
} from '@/components/metadata/metadataEditor'
import { useAppContext } from '@/context'
import { usePaths } from '@/paths'

import { getEditorDefaultValues, MetadataEditorValues, schema } from './schema'

const fragment = graphql(`
	fragment MediaMetadataEditor on MediaMetadata {
		ageRating
		characters
		colorists
		coverArtists
		day
		editors
		format
		identifierAmazon
		identifierCalibre
		identifierGoogle
		identifierIsbn
		identifierMobiAsin
		identifierUuid
		genres
		inkers
		language
		letterers
		links
		month
		notes
		number
		pageCount
		pencillers
		publisher
		series
		seriesGroup
		storyArc
		storyArcNumber
		summary
		teams
		title
		titleSort
		volume
		writers
		year
		lockedFields
	}
`)

const mutation = graphql(`
	mutation UpdateMediaMetadata($id: ID!, $input: MediaMetadataInput!) {
		updateMediaMetadata(id: $id, input: $input) {
			metadata {
				...MediaMetadataEditor
			}
		}
	}
`)

// TODO(metadata): Support some kind of metadata reset
// const resetMetadataMutation = graphql(`
// 	mutation MediaMetadataEditorResetMetadata($id: ID!) {
// 		resetMediaMetadata(id: $id) {
// 			id
// 		}
// 	}
// `)

const setLockedFieldsMutation = graphql(`
	mutation MediaEditorSetLockedFields($mediaId: ID!, $lockedFields: [MetadataField!]!) {
		setMediaLockedFields(mediaId: $mediaId, lockedFields: $lockedFields) {
			id
		}
	}
`)

type Props = {
	mediaId: string
	data?: FragmentType<typeof fragment> | null
}

// TODO(ux): Improve error states within form

/**
 * `data` is snapshotted into state so a successful save can swap in the mutation's own
 * response without waiting for the parent query to refetch. That snapshot is mount-only,
 * so the editor MUST NOT outlive the entity it was mounted for -- callers key it by id
 * (see `MediaMetadataEditorContainer` below), which is what keeps a book-to-book
 * navigation from leaving the previous book's metadata on screen.
 */
function MediaMetadataEditor({ mediaId, data }: Props) {
	const [_data, setData] = useState(() => data)

	const metadata = useFragment(fragment, _data)
	const paths = usePaths()

	const [showMissing, setShowMissing] = useState(false)
	const [lockedFields, setLockedFields] = useState<Set<MetadataField>>(
		() => new Set(metadata?.lockedFields ?? []),
	)

	const [state, setState] = useState<MetadataEditorState>(MetadataEditorState.Display)

	const { checkPermission } = useAppContext()
	const { t } = useLocaleContext()

	const columns = useMemo(
		() => [
			columnHelper.accessor('label', {
				header: ({ table }) => (
					<div className="pl-4 font-bold leading-6 flex h-full items-center text-foreground/90">
						<Label className="flex items-center">
							<CheckBox
								checked={table.getIsSomeRowsExpanded()}
								onClick={() => setShowMissing((prev) => !prev)}
							/>

							<span className="ml-2">Missing</span>
						</Label>
					</div>
				),
				cell: (info) => (
					<div className="gap-1.5 flex items-center">
						<Text variant="muted" className="text-sm font-medium">
							{info.getValue()}
						</Text>
						<LockFieldButton binding={info.row.original.field} />
					</div>
				),
				enableResizing: true,
			}),
			columnHelper.accessor('field', {
				header: () => null,
				cell: (info) =>
					match(info.getValue())
						.with(
							P.union(
								'genres',
								'characters',
								'colorists',
								'coverArtists',
								'editors',
								'inkers',
								'letterers',
								'pencillers',
								'teams',
								'writers',
							),
							(field) => {
								const values = getProperty(metadata, field) ?? []
								return (
									<BadgeListCell
										binding={field}
										values={values}
										itemUrl={(index) => {
											const item = values[index]
											if (!item) return undefined
											return paths.bookSearchWithFilter({
												metadata: { [field]: { likeAnyOf: [item] } },
											})
										}}
									/>
								)
							},
						)
						.with('links', () => {
							const safeUrls = (getProperty(metadata, 'links') ?? []).map((url) => {
								try {
									return new URL(url).hostname
								} catch {
									return url
								}
							})
							return (
								<BadgeListCell
									binding="links"
									values={safeUrls}
									itemUrl={(index) => metadata?.links?.[index]}
								/>
							)
						})
						.with(P.union('summary', 'notes'), (field) => (
							<TextCell binding={field} value={metadata?.[field]} isLong />
						))
						// TODO: Consider breaking out ageRating and storyArcNumber?
						.with(
							P.union(
								'ageRating',
								'day',
								'month',
								'number',
								'pageCount',
								'volume',
								'year',
								'storyArcNumber',
							),
							(field) => (
								<NumberCell
									binding={field}
									value={metadata?.[field]}
									isDecimal={field === 'number'}
								/>
							),
						)
						.with('publisher', () => (
							<BadgeCell
								binding="publisher"
								value={metadata?.publisher}
								itemUrl={() => {
									if (metadata?.publisher == null) return undefined
									return paths.bookSearchWithFilter({
										metadata: { publisher: { likeAnyOf: [metadata.publisher] } },
									})
								}}
							/>
						))
						.with(
							P.union(
								'identifierAmazon',
								'identifierCalibre',
								'identifierGoogle',
								'identifierIsbn',
								'identifierMobiAsin',
								'identifierUuid',
							),
							(field) => (
								<TextCell
									binding={field}
									value={String(getProperty(metadata, info.getValue()) || '')}
									isMonoText
								/>
							),
						)
						// TODO(metadata): Support queried source options for: 'format', 'seriesGroup', 'series', 'storyArc', and 'storyArcNumber' based on 'storyArc' highest number?
						.otherwise((field) => (
							<TextCell
								binding={field}
								value={String(getProperty(metadata, info.getValue()) || '')}
							/>
						)),
				enableResizing: false,
				meta: {
					isGrow: true,
				},
			}),
		],
		[metadata, paths],
	) as ColumnDef<MediaMetadataEditorRow>[]

	const items = useMemo(
		() =>
			MediaMetadataKeys.map((key) => ({
				label: t(getLabelKey(key)),
				field: key,
			})).filter(({ field }) => showMissing || !isEmptyField(metadata?.[field])),
		[metadata, showMissing, t],
	)

	const form = useForm({
		defaultValues: getEditorDefaultValues(metadata),
		resolver: zodResolver(schema),
	})

	const client = useQueryClient()
	const { sdk } = useSDK()

	const onRefetchParents = useCallback(() => {
		client.refetchQueries({
			queryKey: sdk.cacheKey('bookOverview', [mediaId]),
		})
	}, [client, sdk, mediaId])

	const { mutate: updateMetadata } = useGraphQLMutation(mutation, {
		onSuccess: ({ updateMediaMetadata: { metadata } }) => {
			if (metadata) {
				setData(metadata)
			}
			setState(MetadataEditorState.Display)
			onRefetchParents()
		},
		onError: (error) => {
			console.error('Failed to update metadata', error)
			toast.error('Failed to update metadata')
		},
	})

	const { mutate: setLocked } = useGraphQLMutation(setLockedFieldsMutation, {
		onError: () => {
			setLockedFields(new Set(metadata?.lockedFields ?? []))
			toast.error('Failed to update locked fields')
		},
	})

	const onToggleLock = useCallback(
		(field: MetadataField) => {
			const next = new Set(lockedFields)
			if (next.has(field)) {
				next.delete(field)
			} else {
				next.add(field)
			}
			setLockedFields(next)
			setLocked({ mediaId, lockedFields: Array.from(next) })
		},
		[mediaId, lockedFields, setLocked],
	)

	const onSaveMetadata = useCallback(
		(values: MetadataEditorValues) => {
			if (mediaId) {
				updateMetadata({
					id: mediaId,
					input: values,
				})
			}
		},
		[mediaId, updateMetadata],
	)

	const onCancelEdits = useCallback(() => {
		setState(MetadataEditorState.Display)
		form.reset(getEditorDefaultValues(metadata))
	}, [form, metadata])

	return (
		<FormProvider {...form}>
			<MetadataEditorContext.Provider
				value={{
					state,
					setState,
					onCancel: onCancelEdits,
					onSave: () => {
						form.handleSubmit(onSaveMetadata)
					},
					lockedFields,
					onToggleLock,
				}}
			>
				<form onSubmit={form.handleSubmit(onSaveMetadata)}>
					{/*
					 * Above the table, not inside it. These used to be the header of a right-pinned
					 * `actions` column sized to 0px, so the buttons overflowed a zero-width sticky
					 * cell and painted over the field values at narrow widths.
					 */}
					{checkPermission(UserPermission.EditMetadata) && (
						<div className="gap-2 pb-2 flex items-center justify-end">
							<MetadataEditorHeader />
						</div>
					)}
					<MetadataEditorTable<MediaMetadataEditorRow>
						columns={columns}
						items={items}
						showMissing={showMissing}
					/>
				</form>
			</MetadataEditorContext.Provider>
		</FormProvider>
	)
}

/**
 * Keyed wrapper: remounts the editor whenever the book changes, so its mount-only
 * snapshot state (the metadata rows, the locked-field set, and the react-hook-form
 * default values) can never carry over from a previously-viewed book.
 */
export default function MediaMetadataEditorContainer(props: Props) {
	return <MediaMetadataEditor key={props.mediaId} {...props} />
}

const columnHelper = createColumnHelper<MediaMetadataEditorRow>()

const LOCALE_BASE = `metadataEditor`
const getKey = (key: string) => `${LOCALE_BASE}.${key}`
const getLabelKey = (binding: string) => getKey(`labels.${binding}`)
