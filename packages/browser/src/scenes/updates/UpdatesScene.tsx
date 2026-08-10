import { useGraphQL } from '@longbox/client'
import { cx } from '@longbox/components'
import { graphql } from '@longbox/graphql'
import { BellOff, Rss } from 'lucide-react'
import { useState } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'react-router-dom'

import { SceneContainer } from '@/components/container'
import { usePaths } from '@/paths'

import { dayGroupLabel, groupByDay } from './utils'

const query = graphql(`
	query UpdatesFeed {
		updatesFeed {
			items {
				mediaId
				seriesName
				mediaName
				createdAt
				isRead
			}
			capped
		}
	}
`)

const UNREAD_ONLY_KEY = 'longbox_updates_unread'

export default function UpdatesScene() {
	const paths = usePaths()
	const [unreadOnly, setUnreadOnly] = useState(
		() => localStorage.getItem(UNREAD_ONLY_KEY) === 'true',
	)

	const { data, isLoading } = useGraphQL(query, ['updatesFeed'])

	const toggleUnreadOnly = () => {
		setUnreadOnly((current) => {
			localStorage.setItem(UNREAD_ONLY_KEY, String(!current))
			return !current
		})
	}

	const allItems = data?.updatesFeed.items ?? []
	const items = unreadOnly ? allItems.filter((item) => !item.isRead) : allItems
	const groups = groupByDay(items)

	return (
		<SceneContainer className="gap-4 flex flex-col">
			<Helmet>
				<title>Longbox | Updates</title>
			</Helmet>

			<div className="gap-2 flex flex-wrap items-center justify-between">
				<h1 className="text-2xl font-bold">Updates</h1>
				<button
					className={cx(
						'gap-2 px-3 py-1.5 text-sm border-edge flex items-center rounded-md border transition-colors',
						unreadOnly
							? 'bg-background-surface font-medium text-foreground'
							: 'text-foreground-muted hover:text-foreground',
					)}
					aria-pressed={unreadOnly}
					onClick={toggleUnreadOnly}
				>
					<BellOff className="h-4 w-4" />
					Unread only
				</button>
			</div>

			{!isLoading && groups.length === 0 && (
				<div className="gap-2 border-edge p-10 flex flex-col items-center rounded-lg border border-dashed text-center">
					<Rss className="h-8 w-8 text-foreground-muted" />
					<p className="font-medium">{unreadOnly ? 'All caught up' : 'No updates yet'}</p>
					<p className="max-w-md text-sm text-foreground-muted">
						{unreadOnly
							? 'Every new book in your followed series has been read.'
							: 'New books added to series you follow show up here. Follow a series from its page menu to get started.'}
					</p>
				</div>
			)}

			{groups.map((group) => (
				<section key={group.dayKey} className="gap-2 flex flex-col">
					<h2 className="text-sm font-semibold tracking-wide text-foreground-muted uppercase">
						{dayGroupLabel(group.dayKey)}
					</h2>
					<ul className="gap-1 flex flex-col">
						{group.items.map((item) => (
							<li key={item.mediaId}>
								<Link
									to={paths.bookOverview(String(item.mediaId))}
									className="gap-3 p-2 hover:bg-background-surface flex items-center rounded-md"
								>
									<span
										aria-label={item.isRead ? 'Read' : 'Unread'}
										className={cx(
											'h-2 w-2 shrink-0 rounded-full',
											item.isRead ? 'bg-transparent' : 'bg-brand',
										)}
									/>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium truncate">{item.mediaName}</p>
										<p className="text-xs text-foreground-muted truncate">{item.seriesName}</p>
									</div>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}

			{data?.updatesFeed.capped && (
				<p className="text-xs text-foreground-muted text-center">
					Showing the most recent 500 updates.
				</p>
			)}
		</SceneContainer>
	)
}
