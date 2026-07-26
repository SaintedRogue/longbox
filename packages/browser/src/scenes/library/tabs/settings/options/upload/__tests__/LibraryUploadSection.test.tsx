import { useGraphQLUploadMutation, useUploadConfig } from '@longbox/client'
import { UserPermission } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useAppContext } from '@/context'

import { useLibraryManagement } from '../../../context'
import LibraryUploadSection, { BOOK_ACCEPT_ATTRIBUTE } from '../LibraryUploadSection'

jest.mock('@longbox/client', () => ({
	formatBytes: (bytes: number) => `${bytes} bytes`,
	useGraphQLUploadMutation: jest.fn(),
	useUploadConfig: jest.fn(),
}))

jest.mock('@longbox/i18n', () => ({
	useLocaleContext: jest.fn(),
}))

jest.mock('@/context', () => ({
	useAppContext: jest.fn(),
}))

jest.mock('../../../context', () => ({
	useLibraryManagement: jest.fn(),
}))

// The picker pulls in a live directory listing, which is not what any of these assertions
// are about. Its integration is exercised by DirectoryPickerModal's own surface.
jest.mock('@/components/DirectoryPickerModal', () => ({
	__esModule: true,
	default: () => null,
}))

/**
 * Renders the locale key alongside any interpolated values, so a test can assert on both
 * the string that was chosen and the data put into it.
 */
const translate = jest.fn((key: string, options?: Record<string, unknown>) =>
	options ? `${key}|${Object.values(options).join('|')}` : key,
)

const FIVE_GB = 5 * 1024 * 1024 * 1024

const mutateAsync = jest.fn()

type SetupParams = {
	canUpload?: boolean
	enabled?: boolean
}

const setup = ({ canUpload = true, enabled = true }: SetupParams = {}) => {
	jest.mocked(useAppContext).mockReturnValue({
		checkPermission: (permission: UserPermission) =>
			permission === UserPermission.UploadFile ? canUpload : true,
	} as never)

	jest.mocked(useUploadConfig).mockReturnValue({
		uploadConfig: canUpload ? { enabled, maxFileUploadSize: FIVE_GB } : undefined,
		isLoading: false,
	} as never)

	jest.mocked(useLibraryManagement).mockReturnValue({
		library: { id: 'lib-1', path: '/mnt/comics' },
	} as never)

	return render(<LibraryUploadSection />)
}

const getFileInput = () =>
	screen.getByLabelText(/sections\.books\.files\.label/) as HTMLInputElement
const getUploadButton = () => screen.getByRole('button', { name: /sections\.books\.submit/ })

describe('LibraryUploadSection', () => {
	beforeEach(() => {
		jest.clearAllMocks()
		jest.mocked(useLocaleContext).mockReturnValue({ t: translate } as never)
		jest
			.mocked(useGraphQLUploadMutation)
			.mockReturnValue({ mutateAsync, isPending: false } as never)
	})

	it('stays visible but disabled, with an explanation, when uploads are off in server config', () => {
		setup({ enabled: false })

		expect(screen.getByText(/unavailable\.feature\.description/)).toBeInTheDocument()
		expect(getFileInput()).toBeDisabled()
		expect(getUploadButton()).toBeDisabled()
	})

	it('stays visible but disabled, with an explanation, when the user lacks the upload permission', () => {
		setup({ canUpload: false })

		expect(screen.getByText(/unavailable\.permission\.description/)).toBeInTheDocument()
		expect(getFileInput()).toBeDisabled()
		expect(getUploadButton()).toBeDisabled()
	})

	it('filters the picker to the accepted formats and states the size limit up front', () => {
		setup()

		expect(getFileInput()).toHaveAttribute('accept', BOOK_ACCEPT_ATTRIBUTE)
		expect(BOOK_ACCEPT_ATTRIBUTE).toBe('.cbz,.cbr,.epub,.pdf')
		// The limit is stated before anything is selected, and survives being larger than a
		// signed 32-bit int -- the reason maxFileUploadSize is a Float on the wire.
		expect(
			screen.getByText(`sections.books.files.maxSize|${FIVE_GB} bytes`, { exact: false }),
		).toBeInTheDocument()
	})

	it("shows the server's own error message rather than a generic failure", async () => {
		const serverMessage =
			'File art.txt has a disallowed extension, permitted extensions are: ["cbr", "cbz", "epub", "pdf"]'
		mutateAsync.mockRejectedValue(new Error(serverMessage))

		setup()

		await userEvent.upload(getFileInput(), new File(['data'], 'art.cbz'))
		await userEvent.click(getUploadButton())

		expect(await screen.findByText(serverMessage)).toBeInTheDocument()
	})
})
