import { graphql } from '@stump/graphql'

/**
 * The single `updateMediaProgress` mutation document, shared by both readers
 * (BookReaderScene, EpubJsReader) and the progress outbox flush hook, so there is
 * exactly one place that defines the request an outbox row replays.
 */
export const UPDATE_READ_PROGRESS = graphql(`
	mutation UpdateReadProgress($id: ID!, $input: MediaProgressInput!) {
		updateMediaProgress(id: $id, input: $input) {
			__typename
		}
	}
`)
