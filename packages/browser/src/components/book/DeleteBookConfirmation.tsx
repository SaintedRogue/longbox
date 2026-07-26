import { useGraphQLMutation } from '@longbox/client'
import { ConfirmationModal, TypeToConfirmModal } from '@longbox/components'
import { graphql, UserPermission } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'

import { useAppContext } from '@/context'

const mutation = graphql(`
	mutation DeleteBookPermanently($id: ID!, $deleteFile: Boolean!) {
		deleteMediaPermanently(id: $id, deleteFile: $deleteFile) {
			id
		}
	}
`)

const LOCALE_KEY = 'bookManagementScene.deleteBook'
const getKey = (key: string) => `${LOCALE_KEY}.${key}`

type Props = {
	bookId: string
	bookName: string
	/**
	 * When true the underlying file is erased from disk as well, which is irreversible. The
	 * confirmation demands the book's title be typed out in that case.
	 */
	deleteFile: boolean
	isOpen: boolean
	onClose: () => void
	/** Called once the book has been removed, so the caller can navigate away */
	onDeleted: () => void
}

export default function DeleteBookConfirmation({
	bookId,
	bookName,
	deleteFile,
	isOpen,
	onClose,
	onDeleted,
}: Props) {
	const client = useQueryClient()
	const { t } = useLocaleContext()
	const { checkPermission } = useAppContext()

	const {
		mutate: deleteBook,
		isPending,
		error,
	} = useGraphQLMutation(mutation, {
		onSuccess: async () => {
			toast.success(t(getKey(deleteFile ? 'deleteFile.success' : 'removeRecord.success')))
			await client.invalidateQueries({ predicate: () => true })
			onClose()
			onDeleted()
		},
	})

	const isPermitted = useMemo(
		() => checkPermission(UserPermission.DeleteLibrary),
		[checkPermission],
	)

	const handleDelete = useCallback(() => {
		if (isPermitted) {
			deleteBook({ id: bookId, deleteFile })
		}
	}, [deleteBook, deleteFile, isPermitted, bookId])

	useEffect(() => {
		if (!error) return

		console.error(error)
		const fallback = t(getKey('error'))
		toast.error(error instanceof Error ? error.message || fallback : fallback)
	}, [error, t])

	if (deleteFile) {
		return (
			<TypeToConfirmModal
				title={t(getKey('deleteFile.title'))}
				description={t(getKey('deleteFile.description'), { name: bookName })}
				confirmText={t(getKey('deleteFile.confirm'))}
				confirmVariant="destructive"
				isOpen={isOpen}
				onClose={onClose}
				onConfirm={handleDelete}
				confirmIsLoading={isPending}
				confirmationValue={bookName}
				instructionText={t(getKey('deleteFile.typeToConfirm'), { name: bookName })}
			/>
		)
	}

	return (
		<ConfirmationModal
			title={t(getKey('removeRecord.title'))}
			description={t(getKey('removeRecord.description'), { name: bookName })}
			confirmText={t(getKey('removeRecord.confirm'))}
			confirmVariant="destructive"
			isOpen={isOpen}
			onClose={onClose}
			onConfirm={handleDelete}
			confirmIsLoading={isPending}
		/>
	)
}
