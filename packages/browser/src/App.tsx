import './styles/index.css'
import '@longbox/components/styles/overrides.css'

import { LongboxClientContextProvider, LongboxClientProps, SDKProvider } from '@longbox/client'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { Helmet } from 'react-helmet'
import { createSearchParams, useLocation, useNavigate } from 'react-router-dom'

import { ErrorFallback } from '@/components/ErrorFallback'

import { AppRouter } from './AppRouter'
import { Toaster } from './components/Toaster'
import { useApplyTheme } from './hooks'
import { useAppStore, useDebugStore, useUserStore } from './stores'

export default function LongboxWebClient(props: LongboxClientProps) {
	return (
		<ErrorBoundary FallbackComponent={ErrorFallback}>
			<RouterContainer {...props} />
		</ErrorBoundary>
	)
}

const RouterContainer = (props: LongboxClientProps) => {
	const location = useLocation()
	const navigate = useNavigate()

	const showQueryTools = useDebugStore((state) => state.showQueryTools)

	const [mounted, setMounted] = useState(false)

	const setUser = useUserStore((state) => state.setUser)
	const userPreferences = useUserStore((state) => state.userPreferences)

	const baseUrl = useAppStore((state) => state.baseUrl)
	const setBaseUrl = useAppStore((state) => state.setBaseUrl)
	const setPlatform = useAppStore((state) => state.setPlatform)
	const setIsConnectedWithServer = useAppStore((state) => state.setIsConnectedWithServer)

	useEffect(() => {
		if (!baseUrl && props.baseUrl) {
			setBaseUrl(props.baseUrl)
		}

		setMounted(true)
	}, [baseUrl, props.baseUrl, setBaseUrl])

	useEffect(() => {
		setPlatform(props.platform)
	}, [props.platform, setPlatform])

	useApplyTheme({
		appFont: userPreferences?.appFont,
		appTheme: userPreferences?.appTheme,
		interfaceRoundness: userPreferences?.interfaceRoundness,
		thumbnailRoundness: userPreferences?.thumbnailRoundness,
	})

	const handleRedirect = (url: string) => {
		navigate({
			pathname: url,
			search: createSearchParams({
				redirect: location.pathname,
			}).toString(),
		})
	}

	const handleUnauthenticatedResponse = (redirectUrl?: string) => {
		props.onUnauthenticatedResponse?.(redirectUrl)
		setUser(null)
		if (redirectUrl) {
			handleRedirect(redirectUrl)
		}
	}

	const handleConnectionWithServerChanged = (wasReached: boolean) => {
		setIsConnectedWithServer(wasReached)
	}

	if (!mounted) {
		return null
	}

	return (
		<LongboxClientContextProvider
			onUnauthenticatedResponse={handleUnauthenticatedResponse}
			onConnectionWithServerChanged={handleConnectionWithServerChanged}
			onAuthenticated={props.onAuthenticated}
			onLogout={props.onLogout}
		>
			<SDKProvider baseURL={baseUrl || ''} authMethod={props.authMethod || 'session'}>
				{showQueryTools && <ReactQueryDevtools position="right" />}
				<Helmet defaultTitle="Longbox">
					<title>Longbox</title>
				</Helmet>
				<AppRouter />
				<Toaster />
			</SDKProvider>
		</LongboxClientContextProvider>
	)
}
