import type {
	CursorPagination,
	Pagination,
	PaginationInfo,
	TypedDocumentString,
} from '@longbox/graphql'
import { Api } from '@longbox/sdk'
import {
	GraphQLWebsocketConnectEventHandlers,
	GraphQLWebsocketConnectReturn,
} from '@longbox/sdk/socket'
import {
	InfiniteData,
	noop,
	PlaceholderDataFunction,
	QueryKey,
	useInfiniteQuery,
	UseInfiniteQueryResult,
	useMutation,
	UseMutationOptions,
	UseMutationResult,
	useQuery,
	useQueryClient,
	UseQueryOptions,
	type UseQueryResult,
	useSuspenseInfiniteQuery,
	UseSuspenseInfiniteQueryOptions,
	UseSuspenseInfiniteQueryResult,
	useSuspenseQueries,
	useSuspenseQuery,
	UseSuspenseQueryOptions,
	UseSuspenseQueryResult,
} from '@tanstack/react-query'
import { AxiosRequestConfig, isAxiosError } from 'axios'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { match } from 'ts-pattern'

import { ILongboxClientContext, useClientContext } from '../context'
import { useSDK } from '../sdk'

type ErrorHandlerParams = {
	sdk: Api
	error: unknown
} & Pick<ILongboxClientContext, 'onUnauthenticatedResponse' | 'onConnectionWithServerChanged'>
const handleError = ({
	sdk,
	error,
	onUnauthenticatedResponse,
	onConnectionWithServerChanged,
}: ErrorHandlerParams) => {
	if (!error) return
	const axiosError = isAxiosError(error)
	const isNetworkError = axiosError && error?.code === 'ERR_NETWORK'
	const isAuthError = axiosError && error.response?.status === 401
	if (isAuthError) {
		sdk.tokens = undefined
		onUnauthenticatedResponse?.('/auth', error.response?.data)
	} else if (isNetworkError) {
		onConnectionWithServerChanged?.(false)
	}
}

export function usePrefetchGraphQL() {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const onError = useCallback(
		(error: unknown) => {
			handleError({
				sdk,
				error,
				onUnauthenticatedResponse,
				onConnectionWithServerChanged,
			})
		},
		[sdk, onUnauthenticatedResponse, onConnectionWithServerChanged],
	)

	const execute = useCallback(
		<TResult, TVariables>(
			document: TypedDocumentString<TResult, TVariables>,
			variables?: TVariables extends Record<string, never> ? never : TVariables,
		) => sdk.execute(document, variables),
		[sdk],
	)

	const client = useQueryClient()

	return { execute, client, onError }
}

export function useGraphQL<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	queryKey: QueryKey,
	variables?: TVariables extends Record<string, never> ? never : TVariables,
	options?: Omit<UseQueryOptions<TResult, Error, TResult, QueryKey>, 'queryKey' | 'queryFn'>,
): UseQueryResult<TResult> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const { error, ...rest } = useQuery({
		queryKey,
		queryFn: async () => {
			const response = await sdk.execute(document, variables)
			return response
		},
		...options,
	})

	useEffect(() => {
		if (!error) return
		handleError({
			sdk,
			error,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
		})
	}, [error, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return { error, ...rest } as UseQueryResult<TResult>
}

/**
 * The variables a mutation is called with.
 *
 * An operation that declares no variables maps to `void`, not `never`: "takes nothing"
 * should mean you call it with nothing, whereas `never` makes it impossible to call at
 * all. The query hooks sidestepped this by declaring `variables?`, so the mutation hooks
 * were the only place it could bite — and it only did once a zero-variable mutation
 * existed to try it.
 */
type MutationVariables<TVariables> = TVariables extends Record<string, never> ? void : TVariables

type UseGraphQLMutationOptions<TResult, TVariables> = Omit<
	UseMutationOptions<TResult, unknown, MutationVariables<TVariables>, unknown>,
	'mutationFn'
>

export function useGraphQLMutation<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	options: UseGraphQLMutationOptions<TResult, TVariables> = {},
) {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const mutationFn = useCallback(
		async (variables?: MutationVariables<TVariables>) =>
			// The cast reconciles this hook's `void` with the SDK's own `never` spelling;
			// both mean "no variables", and `execute` ignores the argument in that case.
			sdk.execute(document, variables as never),
		[sdk, document],
	)
	const { error, ...rest } = useMutation({
		...options,
		mutationFn,
		onError: (error, variables, context) => {
			handleError({
				sdk,
				error,
				onUnauthenticatedResponse,
				onConnectionWithServerChanged,
			})
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			options?.onError?.(error, variables, noop, context as any)
		},
	})

	return { error, ...rest } as UseMutationResult<
		TResult,
		unknown,
		MutationVariables<TVariables>,
		unknown
	>
}

type UseGraphQLUploadMutationOptions<TResult, TVariables> = Omit<
	UseMutationOptions<TResult, unknown, MutationVariables<TVariables>, unknown>,
	'mutationFn'
> & {
	config?: Pick<AxiosRequestConfig, 'onUploadProgress'>
}

export function useGraphQLUploadMutation<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	{ config, ...options }: UseGraphQLUploadMutationOptions<TResult, TVariables> = {},
) {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const mutationFn = useCallback(
		async (variables?: MutationVariables<TVariables>) =>
			sdk.executeUpload(document, variables as never, config),
		[sdk, document, config],
	)
	const { error, ...rest } = useMutation({
		...options,
		mutationFn,
		onError: (error, variables, context) => {
			handleError({
				sdk,
				error,
				onUnauthenticatedResponse,
				onConnectionWithServerChanged,
			})
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			options?.onError?.(error, variables, noop, context as any)
		},
	})

	return { error, ...rest } as UseMutationResult<
		TResult,
		unknown,
		MutationVariables<TVariables>,
		unknown
	>
}
export function useSuspenseGraphQL<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	queryKey: QueryKey,
	variables?: TVariables extends Record<string, never> ? never : TVariables,
	options?: Omit<
		UseSuspenseQueryOptions<TResult, Error, TResult, QueryKey>,
		'queryKey' | 'queryFn'
	>,
): UseSuspenseQueryResult<TResult> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const { error, ...rest } = useSuspenseQuery({
		queryKey,
		queryFn: async () => {
			const response = await sdk.execute(document, variables)
			return response
		},
		...options,
	})

	useEffect(() => {
		if (!error) return
		handleError({
			sdk,
			error,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
		})
	}, [error, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return { error, ...rest } as UseSuspenseQueryResult<TResult>
}

/**
 * Executes multiple GraphQL queries in parallel using tanstack's useQueries
 *
 * @param queries Array of query configurations
 * @returns Results for each query in the same order
 */
export function useSuspenseGraphQLQueries<TQueries extends readonly unknown[]>(queries: {
	[TQueryIndex in keyof TQueries]: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		document: TypedDocumentString<TQueries[TQueryIndex], any>
		queryKey: QueryKey
		// @ts-expect-error: This is OK
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		variables?: TQueries[TQueryIndex]['document'] extends TypedDocumentString<any, infer TVar>
			? TVar extends Record<string, never>
				? never
				: TVar
			: never
		options?: Omit<
			UseQueryOptions<TQueries[TQueryIndex], Error, TQueries[TQueryIndex], QueryKey>,
			'queryKey' | 'queryFn'
		>
	}
}): { [TQueryIndex in keyof TQueries]: UseSuspenseQueryResult<TQueries[TQueryIndex], Error> } {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	type QueryConfig<T> = {
		queryKey: QueryKey
		queryFn: () => Promise<T>
	} & Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>

	const queryConfigs = queries.map(({ document, queryKey, variables, options }) => ({
		queryKey,
		queryFn: async () => {
			const response = await sdk.execute(document, variables)
			return response
		},
		...options,
	})) as { [TQueryIndex in keyof TQueries]: QueryConfig<TQueries[TQueryIndex]> }

	const results = useSuspenseQueries({ queries: queryConfigs }) as {
		[TQueryIndex in keyof TQueries]: UseSuspenseQueryResult<TQueries[TQueryIndex], Error>
	}

	useEffect(() => {
		results.forEach((result) => {
			if (result.error) {
				handleError({
					sdk,
					error: result.error,
					onUnauthenticatedResponse,
					onConnectionWithServerChanged,
				})
			}
		})
	}, [results, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return results
}

export function useInfiniteSuspenseGraphQL<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	queryKey: QueryKey,
	variables?: TVariables extends Record<string, never> ? never : TVariables,
	options?: Omit<
		UseSuspenseInfiniteQueryOptions<TResult, Error, TResult, readonly unknown[], Pagination>,
		'queryKey' | 'queryFn'
	>,
): UseSuspenseInfiniteQueryResult<InfiniteData<TResult>> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const [initialPageParam] = useState<Pagination>(() => extractInitialPageParam(variables))

	const constructVariables = useCallback(
		(pageParam: Pagination) =>
			({
				...variables,
				pagination: pageParam,
			}) as TVariables extends Record<string, never> ? never : TVariables,
		[variables],
	)

	const { error, ...rest } = useSuspenseInfiniteQuery({
		queryKey,
		queryFn: async ({ pageParam }) => {
			const response = await sdk.execute(document, constructVariables(pageParam))
			return response
		},
		initialPageParam,
		getNextPageParam: (lastPage) => getNextPageParam(extractPageInfo(lastPage)),
		experimental_prefetchInRender: true,
		...options,
	})

	useEffect(() => {
		if (!error) return
		handleError({
			sdk,
			error,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
		})
	}, [error, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return {
		error,
		...rest,
	} as UseSuspenseInfiniteQueryResult<InfiniteData<TResult>>
}

export function useInfiniteGraphQL<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	queryKey: QueryKey,
	variables?: TVariables extends Record<string, never> ? never : TVariables,
	options?: {
		enabled?: boolean
		placeholderData?:
			| InfiniteData<TResult, Pagination>
			| PlaceholderDataFunction<
					InfiniteData<TResult, Pagination>,
					Error,
					InfiniteData<TResult, Pagination>,
					readonly unknown[]
			  >
			| undefined
	},
): UseInfiniteQueryResult<InfiniteData<TResult>> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const [initialPageParam] = useState<Pagination>(() => extractInitialPageParam(variables))

	const constructVariables = useCallback(
		(pageParam: Pagination) =>
			({
				...variables,
				pagination: pageParam,
			}) as TVariables extends Record<string, never> ? never : TVariables,
		[variables],
	)

	const { error, ...rest } = useInfiniteQuery({
		queryKey,
		queryFn: async ({ pageParam }) => {
			const response = await sdk.execute(document, constructVariables(pageParam))
			return response
		},
		initialPageParam,
		getNextPageParam: (lastPage) => getNextPageParam(extractPageInfo(lastPage)),
		experimental_prefetchInRender: true,
		...options,
	})

	useEffect(() => {
		if (!error) return
		handleError({
			sdk,
			error,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
		})
	}, [error, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return {
		error,
		...rest,
	} as UseInfiniteQueryResult<InfiniteData<TResult>>
}

const extractCursorInfo = (data: unknown): CursorPagination | undefined => {
	if (!data || Array.isArray(data)) return undefined

	if (typeof data === 'object' && 'cursorInfo' in data) {
		const info = data.cursorInfo as { nextCursor?: string | null; limit?: number }
		if (!info.nextCursor) return undefined
		return { after: info.nextCursor, limit: info.limit ?? 20 }
	}

	for (const key in data) {
		const value = data[key as keyof typeof data]
		if (typeof value === 'object' && value !== null) {
			const cursor = extractCursorInfo(value)
			if (cursor) return cursor
		}
	}

	return undefined
}

const extractInitialCursorParam = <TVariables>(variables: TVariables): CursorPagination => {
	if (typeof variables !== 'object' || !variables) return { limit: 20 }
	if ('pagination' in variables) {
		const pagination = variables.pagination as CursorPagination
		if (pagination) return pagination
	}
	return { limit: 20 }
}

export function useInfiniteCursorGraphQL<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	queryKey: QueryKey,
	variables?: TVariables extends Record<string, never> ? never : TVariables,
	options?: {
		enabled?: boolean
	},
): UseInfiniteQueryResult<InfiniteData<TResult>> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const [initialPageParam] = useState<CursorPagination>(() => extractInitialCursorParam(variables))

	const constructVariables = useCallback(
		(pageParam: CursorPagination) =>
			({
				...variables,
				pagination: pageParam,
			}) as TVariables extends Record<string, never> ? never : TVariables,
		[variables],
	)

	const { error, ...rest } = useInfiniteQuery({
		queryKey,
		queryFn: async ({ pageParam }) => {
			const response = await sdk.execute(document, constructVariables(pageParam))
			return response
		},
		initialPageParam,
		getNextPageParam: (lastPage) => extractCursorInfo(lastPage),
		...options,
	})

	useEffect(() => {
		if (!error) return
		handleError({
			sdk,
			error,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
		})
	}, [error, sdk, onUnauthenticatedResponse, onConnectionWithServerChanged])

	return {
		error,
		...rest,
	} as UseInfiniteQueryResult<InfiniteData<TResult>>
}

/**
 * Extract the initial page param from the variables object, if any exist
 *
 * @param variables The variables object to extract the pagination info from
 * @returns The initial page param object, or undefined if not found
 */
const extractInitialPageParam = <TVariables>(variables: TVariables): Pagination => {
	if (typeof variables !== 'object' || !variables) return { cursor: { limit: 20 } }
	if ('pagination' in variables) {
		const pagination = variables.pagination as Pagination
		if (pagination) {
			return pagination
		}
	}
	return { cursor: { limit: 20 } }
}

/**
 * Extract the pagination info from an unknown object. This is primarily used to extract
 * the pagination params from a GraphQL result. It aims to be flexible enough to support
 * nested selections with pagination arguments (via recursion).
 *
 * @param data The object to extract the pagination info from
 * @returns The pagination info object, or undefined if not found
 */
export const extractPageInfo = (data: unknown): PaginationInfo | undefined => {
	if (!data || Array.isArray(data)) return undefined
	if (typeof data === 'object' && 'pageInfo' in data) {
		return data.pageInfo as PaginationInfo
	}

	// We need to recursively check each property of the object and any nested objects
	for (const key in data) {
		const value = data[key as keyof typeof data]
		if (typeof value === 'object' && value !== null) {
			const pageInfo = extractPageInfo(value)

			if (pageInfo) {
				return pageInfo
			}
		}
	}

	return undefined
}

/**
 * Get the next page param from the pagination info object. If the pagination info is not
 * present, or if there is no next page, this function will return undefined.
 *
 * @param paginationInfo The pagination info object returned from the GraphQL result
 * @returns A {@link Pagination} object that can be used to fetch the next page of results
 */
export const getNextPageParam = (paginationInfo?: PaginationInfo): Pagination | undefined =>
	match(paginationInfo)
		.with({ __typename: 'CursorPaginationInfo' }, (info) => {
			if (!info.nextCursor) return undefined
			return {
				cursor: {
					after: info.nextCursor,
					limit: info.limit,
				},
			} satisfies Pagination
		})
		.with({ __typename: 'OffsetPaginationInfo' }, (info) => {
			const { currentPage, totalPages } = info
			const nextPage = currentPage + 1
			if (nextPage > totalPages) return undefined
			return {
				offset: {
					page: nextPage,
					pageSize: info.pageSize,
					zeroBased: info.zeroBased,
				},
			} satisfies Pagination
		})
		.otherwise(() => undefined)

export type GraphQLSubscriptionLifecycleParams = {
	onConnected?: (event: Event) => void
	onDisconnected?: (event: CloseEvent) => void
}

export type UseGraphQLSubscriptionCacheParams<TResult, TVariables> = {
	variables?: TVariables extends Record<string, never> ? never : TVariables
	/**
	 * An optional function that is called when the data changes to override how the hook
	 * manages its internal state.
	 */
	onDataChangeCapture?: (oldData: TResult[], newData: TResult) => TResult[]
	/**
	 * The maximum number of items to keep in the cache. If not provided, the default is 10,000.
	 */
	maxCacheSize?: number
} & GraphQLSubscriptionLifecycleParams

export type UseGraphQLSubscriptionCacheReturn<TResult> = [
	TResult[] | undefined,
	WebSocket | null,
	() => void,
]

export function useGraphQLSubscriptionCache<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	{
		variables,
		onDataChangeCapture,
		maxCacheSize = 10_000,
		...params
	}: UseGraphQLSubscriptionCacheParams<TResult, TVariables> = {},
): UseGraphQLSubscriptionCacheReturn<TResult> {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const [socket, setSocket] = useState<WebSocket | null>(null)
	const [dispose, setDispose] = useState<() => void>(() => () => {})

	const [data, setData] = useState<TResult[] | undefined>(undefined)

	if (maxCacheSize <= 10) {
		throw new Error('maxCacheSize must be greater than 10')
	}

	const events = useMemo<Partial<GraphQLWebsocketConnectEventHandlers<TResult>>>(
		() => ({
			onMessage: (payload) => {
				setData((prevData) => {
					if (onDataChangeCapture) {
						return onDataChangeCapture(prevData || [], payload)
					} else {
						const newData = [...(prevData || []), payload]
						if (newData.length > maxCacheSize) {
							return newData.slice(newData.length - maxCacheSize)
						}
						return newData
					}
				})
			},
			onError: (error) => {
				handleError({
					sdk,
					error,
					onUnauthenticatedResponse,
					onConnectionWithServerChanged,
				})
			},
			onOpen: (ev) => params?.onConnected?.(ev),
			onClose: (ev) => params?.onDisconnected?.(ev),
		}),
		[
			sdk,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
			onDataChangeCapture,
			maxCacheSize,
			params,
		],
	)

	const didConfigure = useRef(false)
	/**
	 * An effect responsible for kicking off the socket connection and managing the
	 * lifecycle of the socket. It will only run once, and will clean up the socket when
	 * the component unmounts or when the socket is closed.
	 */
	useEffect(() => {
		if (socket || didConfigure.current) return

		didConfigure.current = true
		const configureSocket = async () => {
			const { socket, unsubscribe } = await sdk.connect<TResult, TVariables>(
				document,
				variables,
				events,
			)

			setSocket(socket)
			setDispose(() => () => {
				unsubscribe()
				socket.close()
				setSocket(null)
				didConfigure.current = false
			})
		}

		configureSocket()

		return () => {
			dispose()
		}
	}, [socket, sdk, document, variables, events, dispose])

	return [data, socket, dispose] as const
}

// TODO: Add socket lifecycle callback options (e.g., onconnect, onclose, etc)

export type UseGraphQLSubscriptionParams<TResult, TVariables> = {
	variables?: TVariables extends Record<string, never> ? never : TVariables
	/**
	 * An optional function that is called when a new message is received
	 */
	onMessage?: (payload: TResult) => void
} & GraphQLSubscriptionLifecycleParams

export type UseGraphQLSubscriptionReturn = [WebSocket | null, () => void]

/**
 * Computes a reconnect delay (in ms) for the given attempt number using a "full jitter"
 * exponential backoff: the delay is a random value in `[0, cap]`, where `cap` doubles per
 * attempt and saturates at 30 seconds. Full jitter (rather than, say, always waiting the
 * cap) avoids a thundering herd of clients all reconnecting at the same instant after a
 * shared server restart/blip.
 */
export const computeReconnectDelay = (attempt: number): number => {
	const cap = Math.min(30_000, 1_000 * 2 ** attempt)
	return Math.round(Math.random() * cap)
}

export function useGraphQLSubscription<TResult, TVariables>(
	document: TypedDocumentString<TResult, TVariables>,
	{ variables, onMessage, ...params }: UseGraphQLSubscriptionParams<TResult, TVariables> = {},
): UseGraphQLSubscriptionReturn {
	const { sdk } = useSDK()
	const { onUnauthenticatedResponse, onConnectionWithServerChanged } = useClientContext()

	const [socket, setSocket] = useState<WebSocket | null>(null)

	/** The current reconnect attempt number, reset to 0 on every successful open */
	const attemptRef = useRef(0)
	/** The pending reconnect timeout, if any, so it can be cancelled on dispose */
	const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	/** Set on dispose (e.g. unmount) so an in-flight connect or scheduled reconnect is a no-op */
	const stoppedRef = useRef(false)
	/** Always holds the latest `connect` closure, so `scheduleReconnect` can call it without
	 *  itself needing `connect` in its dependency array (which would otherwise create a
	 *  connect <-> scheduleReconnect circular dependency) */
	const connectRef = useRef<() => void>(() => {})
	/** The currently-active socket/unsubscribe pair, if connected, so `dispose` can tear it down */
	const activeConnectionRef = useRef<GraphQLWebsocketConnectReturn | null>(null)

	const scheduleReconnect = useCallback(() => {
		if (stoppedRef.current) return

		if (retryTimeoutRef.current) {
			clearTimeout(retryTimeoutRef.current)
		}

		const delay = computeReconnectDelay(attemptRef.current++)
		retryTimeoutRef.current = setTimeout(() => {
			connectRef.current()
		}, delay)
	}, [])

	const events = useMemo<Partial<GraphQLWebsocketConnectEventHandlers<TResult>>>(
		() => ({
			onMessage: (payload) => {
				onMessage?.(payload)
			},
			onError: (error) => {
				handleError({
					sdk,
					error,
					onUnauthenticatedResponse,
					onConnectionWithServerChanged,
				})
			},
			onOpen: (ev) => {
				attemptRef.current = 0
				params?.onConnected?.(ev)
			},
			onClose: (ev) => {
				activeConnectionRef.current = null
				setSocket(null)
				params?.onDisconnected?.(ev)
				scheduleReconnect()
			},
		}),
		[
			sdk,
			onUnauthenticatedResponse,
			onConnectionWithServerChanged,
			onMessage,
			params,
			scheduleReconnect,
		],
	)

	const connect = useCallback(async () => {
		if (stoppedRef.current) return

		try {
			const connection = await sdk.connect<TResult, TVariables>(document, variables, events)

			if (stoppedRef.current) {
				// A dispose() call raced with this in-flight connect -- tear it down immediately
				// rather than leaving a dangling, unreferenced socket open.
				connection.unsubscribe()
				connection.socket.close()
				return
			}

			activeConnectionRef.current = connection
			setSocket(connection.socket)
		} catch (error) {
			handleError({
				sdk,
				error,
				onUnauthenticatedResponse,
				onConnectionWithServerChanged,
			})
			scheduleReconnect()
		}
	}, [
		sdk,
		document,
		variables,
		events,
		onUnauthenticatedResponse,
		onConnectionWithServerChanged,
		scheduleReconnect,
	])

	useEffect(() => {
		connectRef.current = connect
	}, [connect])

	const dispose = useCallback(() => {
		stoppedRef.current = true

		if (retryTimeoutRef.current) {
			clearTimeout(retryTimeoutRef.current)
			retryTimeoutRef.current = undefined
		}

		const current = activeConnectionRef.current
		if (current) {
			current.unsubscribe()
			current.socket.close()
			activeConnectionRef.current = null
		}

		setSocket(null)
	}, [])

	/**
	 * An effect responsible for kicking off the socket connection and managing its lifecycle,
	 * including reconnecting with jittered exponential backoff on disconnect (handled by
	 * `events.onClose` -> `scheduleReconnect` above). This intentionally depends only on the
	 * stable (sdk, document, variables) inputs -- NOT on `events`/`dispose`/`socket` -- so a
	 * reconnect (which updates `socket` and, transitively, could change callback identities)
	 * doesn't tear down and recreate the whole subscription on every render.
	 */
	useEffect(() => {
		stoppedRef.current = false
		connectRef.current()

		return () => {
			dispose()
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sdk, document, variables])

	return [socket, dispose] as const
}
