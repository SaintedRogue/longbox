import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'

import appCss from '@/styles/app.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: 'utf-8',
			},
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1',
			},
			{
				title: 'Longbox Docs',
			},
			{
				name: 'robots',
				content: 'index,follow',
			},
			{
				name: 'description',
				content:
					'"Free, open source, self-hosting for your comic books, manga and digital book collections',
			},
			{
				property: 'og:title',
				content: 'Longbox',
			},
			{
				property: 'og:description',
				content:
					'Free, open source, self-hosting for your comic books, manga and digital book collections.',
			},
			{
				property: 'og:type',
				content: 'website',
			},
			{
				property: 'og:image:alt',
				content: 'Longbox OG Image',
			},
			{
				property: 'og:image:type',
				content: 'image/png',
			},
			{
				property: 'og:image:width',
				content: '1332',
			},
			{
				property: 'og:locale',
				content: 'en_US',
			},
			{
				property: 'og:image:height',
				content: '699',
			},
			{
				property: 'og:description',
				content:
					'Free, open source, self-hosting for your comic books, manga and digital book collections.',
			},
			{ property: 'og:image:alt', content: 'Longbox OG Image' },
			{
				property: 'og:site_name',
				content: 'Longbox',
			},
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'icon', href: '/favicon.ico' },
			{
				rel: 'icon',
				type: 'image/png',
				sizes: '32x32',
				href: '/favicon.png',
			},
		],
	}),
	component: RootComponent,
})

function RootComponent() {
	return (
		<html suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col">
				<RootProvider>
					<Outlet />
				</RootProvider>
				<Scripts />
			</body>
		</html>
	)
}
