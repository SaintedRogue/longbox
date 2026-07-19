import { Button } from '@longbox/components'
import { UserPermission } from '@longbox/graphql'
import { Wand2 } from 'lucide-react'
import { useState } from 'react'

import { ProviderMatchDialog } from '@/components/metadata/providerMatch'
import { useAppContext } from '@/context'

type Props = {
	mediaId: string
}

/**
 * Per-issue "Find metadata match" action on the book detail page. Opens the
 * interactive provider-match dialog scoped to this issue: pick a provider,
 * refine the parser-seeded query, and select a result from the compare-grid.
 */
export default function BookMetadataMatch({ mediaId }: Props) {
	const { checkPermission } = useAppContext()
	const [open, setOpen] = useState(false)

	if (
		!checkPermission(UserPermission.MetadataFetchRecordManage) ||
		!checkPermission(UserPermission.MetadataFetchRecordRead)
	) {
		return null
	}

	return (
		<>
			<Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
				<Wand2 className="mr-1.5 h-4 w-4" />
				Find metadata match
			</Button>
			<ProviderMatchDialog kind="media" id={mediaId} open={open} onOpenChange={setOpen} />
		</>
	)
}
