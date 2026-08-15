import { useGraphQLMutation } from '@longbox/client'
import { Button, Dialog, Input, Text } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { PLUGINS_QUERY_KEY } from './constants'

const registerMutation = graphql(`
	mutation RegisterPluginDialogRegister($input: RegisterPluginInput!) {
		registerPlugin(input: $input) {
			token
			plugin {
				id
				name
				slug
			}
		}
	}
`)

export default function RegisterPluginDialog() {
	const client = useQueryClient()
	const [isOpen, setIsOpen] = useState(false)
	const [baseUrl, setBaseUrl] = useState('')
	// Set once, on success. This is the only time the token is ever available: it is
	// stored encrypted and there is deliberately no way to read it back.
	const [issuedToken, setIssuedToken] = useState<string | null>(null)

	const { mutate, isPending } = useGraphQLMutation(registerMutation, {
		onSuccess: (data) => {
			setIssuedToken(data.registerPlugin.token)
			client.invalidateQueries({ queryKey: PLUGINS_QUERY_KEY })
		},
		onError: (error) => toast.error('Could not register plugin', { description: String(error) }),
	})

	const close = () => {
		setIsOpen(false)
		setBaseUrl('')
		setIssuedToken(null)
	}

	return (
		<>
			<Button className="shrink-0" variant="secondary" size="sm" onClick={() => setIsOpen(true)}>
				Register plugin
			</Button>

			<Dialog open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : close())}>
				<Dialog.Content size="md">
					<Dialog.Header>
						<Dialog.Title>{issuedToken ? 'Copy the token' : 'Register a plugin'}</Dialog.Title>
						<Dialog.Close onClick={close} />
					</Dialog.Header>

					{issuedToken ? (
						<div className="gap-3 py-2 flex flex-col">
							<Text size="sm">
								Put this in the plugin&apos;s configuration. Longbox sends it as{' '}
								<code>Authorization: Bearer …</code> on every call.
							</Text>
							<code className="p-3 text-xs rounded-md bg-muted break-all text-foreground select-all">
								{issuedToken}
							</code>
							<Text size="sm" variant="muted">
								This is the only time it is shown — it is stored encrypted and cannot be read back.
								If you lose it, rotate the token from the plugin&apos;s card.
							</Text>
							<Text size="sm" variant="muted">
								The plugin is registered but <strong>disabled</strong>. Configure it, use Test
								connection, then enable it.
							</Text>
						</div>
					) : (
						<div className="gap-3 py-2 flex flex-col">
							<div className="gap-1 flex flex-col">
								<Text size="sm" className="font-medium">
									Base URL
								</Text>
								<Input
									value={baseUrl}
									autoFocus
									placeholder="http://my-plugin:8080/longbox/v1"
									onChange={(event) => setBaseUrl(event.target.value)}
								/>
							</div>
							<Text size="sm" variant="muted">
								Longbox reads the plugin&apos;s manifest before registering it, so this has to be
								reachable now. Nothing is stored if the handshake fails.
							</Text>
						</div>
					)}

					<Dialog.Footer>
						{issuedToken ? (
							<Button onClick={close}>Done</Button>
						) : (
							<>
								<Button variant="outline" onClick={close} disabled={isPending}>
									Cancel
								</Button>
								<Button
									disabled={!baseUrl.trim() || isPending}
									isLoading={isPending}
									onClick={() => mutate({ input: { baseUrl: baseUrl.trim() } })}
								>
									Register
								</Button>
							</>
						)}
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog>
		</>
	)
}
