import { useGraphQLMutation } from '@longbox/client'
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	ConfirmationModal,
	Heading,
	Text,
} from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { Info } from 'lucide-react'
import { Suspense, useState } from 'react'
import { toast } from 'sonner'

import { useLibraryManagement } from '../../context'
import { buildCleanLibraryMessage, getCleanLibraryKey as getKey } from './cleanLibraryResult'
import MisisngEntitiesTable from './MissingEntitiesTable'

const mutation = graphql(`
	mutation CleanLibrary($id: ID!) {
		cleanLibrary(id: $id) {
			deletedMediaCount
			deletedSeriesCount
			missingFileCount
			storageUnavailable
			isEmpty
		}
	}
`)

export default function CleanLibrary() {
	const {
		library: { id },
	} = useLibraryManagement()
	const { t } = useLocaleContext()
	const { mutateAsync: cleanLibrary, isPending } = useGraphQLMutation(mutation)

	const [showConfirmation, setShowConfirmation] = useState(false)

	const handleClean = async () => {
		try {
			toast.promise(cleanLibrary({ id }), {
				loading: t(getKey('confirmation.loading')),
				success: ({ cleanLibrary: result }) => buildCleanLibraryMessage(result, t),
				error: (error) => {
					const fallbackMessage = t(getKey('confirmation.error'))
					if (error instanceof Error) {
						return error.message || fallbackMessage
					}
					return fallbackMessage
				},
			})
			setShowConfirmation(false)
		} catch (error) {
			console.error(error)
			const fallbackMessage = 'An error occurred while cleaning the library'
			if (error instanceof Error) {
				toast.error(error.message || fallbackMessage)
			} else {
				toast.error(fallbackMessage)
			}
		}
	}

	return (
		<div className="space-y-4 flex flex-col">
			<div className="flex items-end justify-between">
				<div>
					<Heading size="sm">{t(getKey('heading'))}</Heading>
					<Text size="sm" variant="muted" className="mt-1">
						{t(getKey('description'))}
					</Text>
				</div>

				<ConfirmationModal
					title={t(getKey('confirmation.label'))}
					description={t(getKey('confirmation.text'))}
					confirmText={t(getKey('confirmation.label'))}
					confirmVariant="destructive"
					isOpen={showConfirmation}
					onClose={() => setShowConfirmation(false)}
					onConfirm={handleClean}
					confirmIsLoading={isPending}
					trigger={
						<div>
							{/* Note: this is deliberately not gated on the table below being empty.
							    That table only lists records a scan already flagged as missing, and
							    the whole point of a clean is to also catch records still marked
							    ready whose file has since disappeared — which never appear there. */}
							<Button
								type="button"
								onClick={() => setShowConfirmation(true)}
								className="shrink-0"
								disabled={isPending}
								isLoading={isPending}
								variant="destructive"
							>
								{t(getKey('confirmation.label'))}
							</Button>
						</div>
					}
				/>
			</div>

			<Alert variant="info" id="clean-library-info" dismissible>
				<Info />
				<AlertTitle>{t(getKey('disclaimerTitle'))}</AlertTitle>
				<AlertDescription>{t(getKey('disclaimer'))}</AlertDescription>
			</Alert>

			<Suspense>
				<MisisngEntitiesTable />
			</Suspense>
		</div>
	)
}
