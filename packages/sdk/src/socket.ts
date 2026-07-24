import { TypedDocumentString } from '@longbox/graphql'

import { Api } from './api'
import { GraphQLError, GraphQLResponse } from './types/graphql'

export const DEFAULT_SOCKET_TIMEOUT = 10000

/**
 * How often we send a client-initiated keepalive ping once the graphql-ws handshake
 * (`connection_init`/`connection_ack`) has completed.
 */
export const PING_INTERVAL_MS = 30_000
/**
 * How long we wait for a `pong` response to a ping before treating the connection as
 * dead and force-closing the socket, which triggers the caller's reconnect logic.
 */
export const PONG_TIMEOUT_MS = 10_000

export type GraphQLWebsocketConnectEventHandlers<TResult> = {
	onOpen: (ev: Event) => void
	onMessage: (data: TResult) => void
	onError: (error: GraphQLError[] | Error) => void
	onClose: (ev: CloseEvent) => void
}

export type GraphQLWebsocketConnectParams<TResult, TVariables> = {
	query: TypedDocumentString<TResult, TVariables>
	variables?: TVariables extends Record<string, never> ? never : TVariables
	sdk: Api
} & Partial<GraphQLWebsocketConnectEventHandlers<TResult>>

export type GraphQLWebsocketConnectReturn = {
	unsubscribe: () => void
	socket: WebSocket
}

/**
 * Attempts to connect to the GraphQL WebSocket endpoint and subscribe to the given query after
 * an HTTP instance received a 101 switching protocol response.
 */
export const attemptWebsocketConnect = async <TResult, TVariables>({
	query,
	variables,
	sdk,
	...events
}: GraphQLWebsocketConnectParams<TResult, TVariables>): Promise<GraphQLWebsocketConnectReturn> => {
	const wsUrl = new URL('/api/graphql/ws', sdk.rootURL.replace(/^http/, 'ws')).toString()

	const socket = new WebSocket(wsUrl, 'graphql-ws')
	const socketID = Math.random().toString(36).substring(2, 15)

	// Client-initiated ping/pong keepalive, armed once `connection_ack` is received (see the
	// message handler below). If a `pong` doesn't arrive within PONG_TIMEOUT_MS, we force-close
	// the socket so the caller's reconnect logic (e.g. `useGraphQLSubscription`) kicks in --
	// async-graphql's websocket handler replies to `ping` frames automatically, so a missing
	// `pong` means the connection is dead even though it may not have emitted a close event yet.
	let pingIntervalId: ReturnType<typeof setInterval> | undefined
	let pongTimeoutId: ReturnType<typeof setTimeout> | undefined

	const clearKeepaliveTimers = () => {
		if (pingIntervalId !== undefined) {
			clearInterval(pingIntervalId)
			pingIntervalId = undefined
		}
		if (pongTimeoutId !== undefined) {
			clearTimeout(pongTimeoutId)
			pongTimeoutId = undefined
		}
	}

	const startKeepalive = () => {
		clearKeepaliveTimers()
		pingIntervalId = setInterval(() => {
			if (socket.readyState !== WebSocket.OPEN) return

			socket.send(JSON.stringify({ type: 'ping', payload: null }))

			pongTimeoutId = setTimeout(() => {
				socket.close(4000, 'ping timeout')
			}, PONG_TIMEOUT_MS)
		}, PING_INTERVAL_MS)
	}

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('WebSocket connection timeout'))
		}, sdk.config.socketTimeout)

		const errorHandler = () => {
			clearTimeout(timeout)
			socket.removeEventListener('open', openHandler)
			reject(new Error('Failed to establish WebSocket connection'))
		}

		const openHandler = (ev: Event) => {
			clearTimeout(timeout)
			socket.removeEventListener('error', errorHandler)
			events.onOpen?.(ev)
			resolve()
		}

		const closeHandler = (ev: CloseEvent) => {
			clearTimeout(timeout)
			socket.removeEventListener('error', errorHandler)
			clearKeepaliveTimers()
			events.onClose?.(ev)
		}

		socket.addEventListener('open', openHandler)
		socket.addEventListener('error', errorHandler)
		socket.addEventListener('close', closeHandler)
	})

	socket.addEventListener('message', (event) => {
		try {
			const message = JSON.parse(event.data)

			// See https://github.com/enisdenjo/graphql-ws/blob/master/PROTOCOL.md
			switch (message.type) {
				case 'connection_ack': {
					socket.send(
						JSON.stringify({
							id: socketID,
							type: 'start',
							payload: {
								query: query.toString(),
								variables: variables || {},
							},
						}),
					)
					startKeepalive()
					break
				}

				case 'pong': {
					if (pongTimeoutId !== undefined) {
						clearTimeout(pongTimeoutId)
						pongTimeoutId = undefined
					}
					break
				}

				case 'data': {
					// TODO: type safety
					const data = message.payload as GraphQLResponse<TResult>

					if (data.errors) {
						events.onError?.(data.errors)
					} else {
						events.onMessage?.(data.data)
					}

					break
				}

				case 'error': {
					console.error('GraphQL subscription error:', message.payload)
					events.onError?.(new Error(message.payload))
					break
				}

				case 'complete': {
					socket.close()
					break
				}
			}
		} catch (error) {
			events.onError?.(error as GraphQLError[] | Error)
		}
	})

	socket.addEventListener('error', (event) => {
		const error = event as unknown as ErrorEvent
		events.onError?.(new Error(error.message))
	})

	// TODO: cookies?? We upgrade the connection so not sure if this is needed
	socket.send(
		JSON.stringify({
			type: 'connection_init',
			payload: {
				headers: {
					...sdk.headers,
				},
			},
		}),
	)

	return {
		socket,
		unsubscribe: () => {
			if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
				if (socket.readyState === WebSocket.OPEN) {
					socket.send(
						JSON.stringify({
							id: socketID,
							type: 'stop',
						}),
					)
				}

				socket.close()
			}
		},
	}
}
