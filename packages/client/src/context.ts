import { AuthenticationMethod, AuthUser, JwtTokenPair } from '@longbox/sdk'
import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

// TODO: Not sure I need this...?
export const QueryClientContext = createContext<QueryClient | undefined>(undefined)

export type CredentialStoreTokenState = Record<string, boolean>

export type ILongboxClientContext = {
	onRedirect?: (url: string) => void
	onUnauthenticatedResponse?: (redirectUrl?: string, data?: unknown) => void
	onConnectionWithServerChanged?: (isConnected: boolean) => void
	onAuthenticated?: (user: AuthUser, token?: JwtTokenPair) => Promise<void>
	onLogout?: () => Promise<void>
}

export const LongboxClientContext = createContext<ILongboxClientContext | undefined>(undefined)

// TODO: 'android' | 'ios' --> https://reactnative.dev/docs/platform
/**
 * The platform that the application is running on
 */
export type Platform = 'browser' | 'macOS' | 'windows' | 'linux' | 'mobile' | 'unknown'

/**
 * The props that are passed to the root of the application
 */
export type LongboxClientProps = {
	authMethod?: AuthenticationMethod
	platform: Platform
	baseUrl?: string
} & Pick<ILongboxClientContext, 'onAuthenticated' | 'onLogout' | 'onUnauthenticatedResponse'>

export const useClientContext = () => {
	const context = useContext(LongboxClientContext)
	if (!context) {
		throw new Error('LongboxContext not found')
	}
	return context
}
