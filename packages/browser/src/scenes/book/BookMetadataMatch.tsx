import { useGraphQLMutation, useSDK } from '@longbox/client'
import { Button } from '@longbox/components'
import {
	FragmentType,
	graphql,
	MetadataFetchStatus,
	useFragment,
	UserPermission,
} from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
	MatchReviewDialog,
	pendingMatchRecordFragment,
	useMatchReviewStore,
} from '@/components/metadata/metadataMatching'
import { useAppContext } from '@/context'

const findMatchMutation = graphql(`
	mutation BookFindMetadataMatch($id: ID!) {
		fetchMediaMetadata(id: $id) {
			provider
		}
	}
`)

const fetchRecordQuery = graphql(`
	query BookMetadataFetchRecord($media: String!) {
		metadataFetchRecord(id: { media: $media }) {
			...PendingMatchRecord
		}
	}
`)

type Props = {
	mediaId: string
}

/**
 * Per-issue "Find metadata match" action for the book detail page. Searches the
 * enabled providers for just this issue via `fetchMediaMetadata`, then opens the
 * shared review dialog to pick a candidate (when review is pending) or reports that a
 * high-confidence match was auto-applied. Reuses the metadataMatching dialog/store.
 */
export default function BookMetadataMatch({ mediaId }: Props) {
	const { sdk } = useSDK()
	const client = useQueryClient()
	const { checkPermission } = useAppContext()
	const openReview = useMatchReviewStore((state) => state.open)
	const isReviewOpen = useMatchReviewStore((state) => state.isOpen)
	const [isSearching, setIsSearching] = useState(false)
	const [pendingRecord, setPendingRecord] = useState<
		FragmentType<typeof pendingMatchRecordFragment> | null | undefined
	>(null)
	const wasReviewOpen = useRef(false)

	const { mutateAsync: findMatch } = useGraphQLMutation(findMatchMutation)

	const record = useFragment(pendingMatchRecordFragment, pendingRecord)

	// When a fetch resolves a record, either open the review dialog (pending review) or
	// report that a high-confidence match was auto-applied per the provider's config.
	useEffect(() => {
		if (!record) {
			return
		}
		if (record.status === MetadataFetchStatus.AwaitingReview) {
			openReview([record], 0)
		} else {
			toast.success('A high-confidence match was applied automatically.')
			void client.invalidateQueries({ queryKey: sdk.cacheKey('bookOverview', [mediaId]) })
		}
		setPendingRecord(null)
	}, [record, openReview, client, sdk, mediaId])

	// Accepting a match inside the dialog mutates media_metadata; refresh the book once
	// the dialog closes so the new title/credits show without a manual reload.
	useEffect(() => {
		if (wasReviewOpen.current && !isReviewOpen) {
			void client.invalidateQueries({ queryKey: sdk.cacheKey('bookOverview', [mediaId]) })
		}
		wasReviewOpen.current = isReviewOpen
	}, [isReviewOpen, client, sdk, mediaId])

	if (
		!checkPermission(UserPermission.MetadataFetchRecordManage) ||
		!checkPermission(UserPermission.MetadataFetchRecordRead)
	) {
		return null
	}

	const handleFind = async () => {
		setIsSearching(true)
		try {
			const { fetchMediaMetadata: candidates } = await findMatch({ id: mediaId })
			if (!candidates.length) {
				toast.info('No metadata matches found for this issue.')
				return
			}

			const { metadataFetchRecord } = await sdk.execute(fetchRecordQuery, {
				media: mediaId,
			})
			if (!metadataFetchRecord) {
				toast.info('No metadata matches found for this issue.')
				return
			}

			setPendingRecord(metadataFetchRecord)
		} catch (error) {
			toast.error('Failed to search for metadata.', {
				description: error instanceof Error ? error.message : undefined,
			})
		} finally {
			setIsSearching(false)
		}
	}

	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				onClick={handleFind}
				isLoading={isSearching}
				disabled={isSearching}
			>
				<Wand2 className="mr-1.5 h-4 w-4" />
				Find metadata match
			</Button>
			<MatchReviewDialog />
		</>
	)
}
