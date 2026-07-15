import { AuthenticationMethod, AuthUser, JwtTokenPair } from '@stump/sdk'
import { QueryClient } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

// TODO: Not sure I need this...?
export const QueryClientContext = createContext<QueryClient | undefined>(undefined)

export type CredentialStoreTokenState = Record<string, boolean>

export type IStumpClientContext = {
	onRedirect?: (url: string) => void
	onUnauthenticatedResponse?: (redirectUrl?: string, data?: unknown) => void
	onConnectionWithServerChanged?: (isConnected: boolean) => void
	onAuthenticated?: (user: AuthUser, token?: JwtTokenPair) => Promise<void>
	onLogout?: () => Promise<void>
}

export const StumpClientContext = createContext<IStumpClientContext | undefined>(undefined)

// TODO: 'android' | 'ios' --> https://reactnative.dev/docs/platform
/**
 * The platform that the application is running on
 */
export type Platform = 'browser' | 'macOS' | 'windows' | 'linux' | 'mobile' | 'unknown'

/**
 * The props that are passed to the root of the application
 */
export type StumpClientProps = {
	authMethod?: AuthenticationMethod
	platform: Platform
	baseUrl?: string
} & Pick<IStumpClientContext, 'onAuthenticated' | 'onLogout' | 'onUnauthenticatedResponse'>

export const useClientContext = () => {
	const context = useContext(StumpClientContext)
	if (!context) {
		throw new Error('StumpContext not found')
	}
	return context
}
