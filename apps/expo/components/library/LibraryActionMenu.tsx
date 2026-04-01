import { useGraphQLMutation } from '@stump/client'
import { graphql, UserPermission } from '@stump/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { Info, ScanLine } from 'lucide-react-native'

import { useStumpServer } from '../activeServer'
import { ActionMenu } from '../ui/action-menu/action-menu'

const mutation = graphql(`
	mutation LibraryActionMenuScanLibrary($id: ID!) {
		scanLibrary(id: $id)
	}
`)

type Props = {
	libraryId: string
	onShowOverview: () => void
}

export default function LibraryActionMenu({ libraryId, onShowOverview }: Props) {
	const { checkPermission } = useStumpServer()

	const client = useQueryClient()
	const { mutate } = useGraphQLMutation(mutation, {
		onSuccess: () => {
			setTimeout(
				() => client.refetchQueries({ queryKey: ['libraryById', libraryId], exact: false }),
				2000,
			)
		},
	})

	return (
		<ActionMenu
			groups={[
				{
					items: [
						{
							icon: {
								ios: 'info.circle',
								android: Info,
							},
							label: 'Overview',
							onPress: onShowOverview,
						},
					],
				},
				...(checkPermission(UserPermission.ScanLibrary)
					? [
							{
								items: [
									{
										icon: {
											ios: 'document.viewfinder',
											android: ScanLine,
										},
										label: 'Scan Library',
										onPress: () => mutate({ id: libraryId }),
									} as const,
								],
							},
						]
					: []),
			]}
		/>
	)
}
