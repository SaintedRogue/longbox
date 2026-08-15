import { formatBytes, useGraphQLUploadMutation, useUploadConfig } from '@longbox/client'
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Label,
	ProgressBar,
	Text,
} from '@longbox/components'
import { extractErrorMessage, graphql, UserPermission } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { AxiosProgressEvent } from 'axios'
import { AlertCircle, CircleCheck, FolderOpen } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import DirectoryPickerModal from '@/components/DirectoryPickerModal'
import { useAppContext } from '@/context'

import { useLibraryManagement } from '../../context'

/**
 * The extensions the server accepts for a book upload, mirroring `ALLOWED_EXTENSIONS` in
 * `crates/graphql/src/mutation/upload.rs`.
 *
 * This is a convenience filter for the file picker, *not* the actual gate: the server also
 * infers the mime type from the file's magic bytes, so a renamed file is still rejected.
 */
export const ACCEPTED_BOOK_EXTENSIONS = ['.cbz', '.cbr', '.epub', '.pdf'] as const
export const BOOK_ACCEPT_ATTRIBUTE = ACCEPTED_BOOK_EXTENSIONS.join(',')

const FILE_INPUT_ID = 'library-upload-books-input'

const uploadBooksMutation = graphql(`
	mutation LibraryUploadSectionUploadBooks($input: UploadBooksInput!) {
		uploadBooks(input: $input)
	}
`)

type Outcome = { status: 'success' } | { status: 'error'; message: string }

/**
 * Why the upload control is unavailable, if it is. Both cases render the control in a
 * visibly disabled state with an explanation rather than hiding it, so that an operator
 * can tell the difference between "this server doesn't do that" and "I can't find it".
 */
type DisabledReason = 'permission' | 'feature' | 'loading'

export default function LibraryUploadSection() {
	const { t } = useLocaleContext()
	const { checkPermission } = useAppContext()
	const { library } = useLibraryManagement()

	const [files, setFiles] = useState<File[]>([])
	const [placeAt, setPlaceAt] = useState(library.path)
	const [isPickerOpen, setIsPickerOpen] = useState(false)
	const [progress, setProgress] = useState(0)
	const [outcome, setOutcome] = useState<Outcome | null>(null)

	const canUpload = checkPermission(UserPermission.UploadFile)
	const { uploadConfig, isLoading: isLoadingConfig } = useUploadConfig({ enabled: canUpload })

	const disabledReason = useMemo((): DisabledReason | null => {
		if (!canUpload) return 'permission'
		if (isLoadingConfig) return 'loading'
		if (!uploadConfig?.enabled) return 'feature'
		return null
	}, [canUpload, isLoadingConfig, uploadConfig?.enabled])

	const maxFileUploadSize = uploadConfig?.maxFileUploadSize
	const oversizedFiles = useMemo(
		() => (maxFileUploadSize ? files.filter(({ size }) => size > maxFileUploadSize) : []),
		[files, maxFileUploadSize],
	)

	const uploadRequestConfig = useMemo(
		() => ({
			onUploadProgress: ({ loaded, total }: AxiosProgressEvent) =>
				setProgress(total && total > 0 ? Math.round((loaded * 100) / total) : 0),
		}),
		[],
	)

	const { mutateAsync: uploadBooks, isPending } = useGraphQLUploadMutation(uploadBooksMutation, {
		config: uploadRequestConfig,
	})

	const handleFilesSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		setOutcome(null)
		setFiles(Array.from(event.target.files ?? []))
	}, [])

	const handlePathChange = useCallback(
		(path: string | null) => {
			if (!path) return

			// The server independently rejects anything outside the library, but refusing here
			// gives an immediate, specific message instead of a round trip to a generic one.
			if (path !== library.path && !path.startsWith(`${library.path}/`)) {
				setOutcome({ status: 'error', message: t(getKey('destination.outsideLibrary')) })
				return
			}

			setOutcome(null)
			setPlaceAt(path)
		},
		[library.path, t],
	)

	const handleUpload = useCallback(async () => {
		if (!files.length) return

		setOutcome(null)
		setProgress(0)

		try {
			await uploadBooks({ input: { libraryId: library.id, placeAt, uploads: files } })
			setFiles([])
			setOutcome({ status: 'success' })
		} catch (error) {
			// The server returns precise, actionable messages here (disallowed extension, size
			// exceeded, "Upload path is not a directory"), so show them verbatim rather than
			// flattening everything into a generic failure.
			setOutcome({ status: 'error', message: extractErrorMessage(error) })
		}
	}, [files, library.id, placeAt, uploadBooks])

	const isDisabled = disabledReason !== null || isPending
	const relativeDestination = placeAt.slice(library.path.length).replace(/^\//, '')

	return (
		<div className="gap-y-4 flex flex-col">
			<div>
				<Label className="text-base">{t(getKey('heading'))}</Label>
				<Text variant="muted">{t(getKey('description'))}</Text>
			</div>

			{disabledReason === 'permission' && (
				<Alert variant="warning" className="max-w-2xl">
					<AlertCircle />
					<AlertTitle>{t(getKey('unavailable.permission.title'))}</AlertTitle>
					<AlertDescription>{t(getKey('unavailable.permission.description'))}</AlertDescription>
				</Alert>
			)}

			{disabledReason === 'feature' && (
				<Alert variant="warning" className="max-w-2xl">
					<AlertCircle />
					<AlertTitle>{t(getKey('unavailable.feature.title'))}</AlertTitle>
					<AlertDescription>{t(getKey('unavailable.feature.description'))}</AlertDescription>
				</Alert>
			)}

			<div className="gap-y-2 flex flex-col">
				<Label htmlFor={FILE_INPUT_ID}>{t(getKey('files.label'))}</Label>
				<input
					id={FILE_INPUT_ID}
					type="file"
					multiple
					accept={BOOK_ACCEPT_ATTRIBUTE}
					disabled={isDisabled}
					onChange={handleFilesSelected}
					className="max-w-2xl text-sm file:mr-3 file:px-3 file:py-1.5 file:text-sm text-muted-foreground file:cursor-pointer file:rounded-md file:border file:border-border file:bg-muted file:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
				/>
				<Text size="sm" variant="muted">
					{t(getKey('files.accepted'), { extensions: ACCEPTED_BOOK_EXTENSIONS.join(', ') })}
				</Text>
				<Text size="sm" variant="muted">
					{maxFileUploadSize
						? t(getKey('files.maxSize'), { size: formatBytes(maxFileUploadSize) })
						: t(getKey('files.maxSizeUnknown'))}
				</Text>
			</div>

			<div className="gap-y-2 flex flex-col">
				<Label>{t(getKey('destination.label'))}</Label>
				<div className="gap-x-3 flex items-center">
					<Text size="sm" className="line-clamp-1">
						{relativeDestination || t(getKey('destination.libraryRoot'))}
					</Text>
					<Button
						size="sm"
						variant="outline"
						disabled={isDisabled}
						onClick={() => setIsPickerOpen(true)}
					>
						<FolderOpen className="mr-2 h-4 w-4" />
						{t(getKey('destination.change'))}
					</Button>
				</div>
				<Text size="sm" variant="muted">
					{t(getKey('destination.description'))}
				</Text>
			</div>

			{files.length > 0 && (
				<ul className="gap-y-1 max-w-2xl flex flex-col">
					{files.map((file) => (
						<li key={`${file.name}:${file.size}:${file.lastModified}`}>
							<Text size="sm" variant="muted">
								{file.name} ({formatBytes(file.size)})
							</Text>
						</li>
					))}
				</ul>
			)}

			{oversizedFiles.length > 0 && (
				<Alert variant="destructive" className="max-w-2xl">
					<AlertCircle />
					<AlertDescription>
						{t(getKey('files.tooLarge'), {
							names: oversizedFiles.map(({ name }) => name).join(', '),
							size: formatBytes(maxFileUploadSize),
						})}
					</AlertDescription>
				</Alert>
			)}

			{isPending && (
				<div className="max-w-2xl gap-y-2 flex flex-col">
					<Text size="sm" variant="muted">
						{t(getKey('uploading'), { progress })}
					</Text>
					<ProgressBar value={progress} isIndeterminate={progress === 0} max={100} />
				</div>
			)}

			{outcome?.status === 'success' && (
				<Alert variant="success" className="max-w-2xl">
					<CircleCheck />
					<AlertTitle>{t(getKey('success.title'))}</AlertTitle>
					<AlertDescription>{t(getKey('success.description'))}</AlertDescription>
				</Alert>
			)}

			{outcome?.status === 'error' && (
				<Alert variant="destructive" className="max-w-2xl">
					<AlertCircle />
					<AlertTitle>{t(getKey('error.title'))}</AlertTitle>
					<AlertDescription>{outcome.message}</AlertDescription>
				</Alert>
			)}

			<div>
				<Button
					size="sm"
					disabled={isDisabled || !files.length || oversizedFiles.length > 0}
					isLoading={isPending}
					onClick={handleUpload}
				>
					{t(getKey('submit'))}
				</Button>
			</div>

			<DirectoryPickerModal
				isOpen={isPickerOpen}
				onClose={() => setIsPickerOpen(false)}
				startingPath={placeAt}
				onPathChange={handlePathChange}
			/>
		</div>
	)
}

const LOCALE_BASE = 'librarySettingsScene.options/upload.sections.books'
const getKey = (key: string) => `${LOCALE_BASE}.${key}`
