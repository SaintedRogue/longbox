import { APIBase } from '../base'
import { createRouteURLHandler } from './utils'

/**
 * The widths the server will actually honour for a downscaled page preview, mirroring
 * `THUMBNAIL_VARIANT_WIDTHS` in the Rust core. It is a whitelist rather than a free parameter so a
 * client cannot make the server mint an unbounded number of distinct renders of the same page;
 * anything outside it silently falls through to the full-resolution page.
 */
export const PAGE_PREVIEW_WIDTHS = [160, 320, 480, 640] as const
export type PagePreviewWidth = (typeof PAGE_PREVIEW_WIDTHS)[number]

export type BookPageParams = {
	/**
	 * Ask for a downscaled WebP preview of the page instead of the source image. Only for UI that
	 * paints pages at thumbnail size -- a full-resolution comic page is measured in megabytes.
	 */
	width?: PagePreviewWidth
}

/**
 * The root route for the media API
 */
const MEDIA_ROUTE = '/media'
/**
 * A helper function to format the URL for media API routes with optional query parameters
 */
const mediaURL = createRouteURLHandler(MEDIA_ROUTE)

/**
 * The media API controller, used for interacting with the media endpoints of the Longbox API
 */
export class MediaAPI extends APIBase {
	/**
	 * The URL for fetching the thumbnail of a media entity
	 */
	thumbnailURL(id: string): string {
		return this.withServiceURL(mediaURL(`/${id}/thumbnail`))
	}

	/**
	 * The URL for fetching the file of a media entity
	 */
	downloadURL(id: string): string {
		return this.withServiceURL(mediaURL(`/${id}/file`))
	}

	/**
	 * The URL for fetching a page of a media entity
	 */
	bookPageURL(mediaID: string, page: number, params?: BookPageParams): string {
		return this.withServiceURL(mediaURL(`${mediaID}/page/${page}`, params))
	}
}
