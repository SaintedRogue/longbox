import { useLongboxVersion } from '@longbox/client'
import { cx, Link, TEXT_VARIANTS } from '@longbox/components'
import { useMemo } from 'react'

export default function ApplicationVersion() {
	const version = useLongboxVersion()

	const url = useMemo(() => {
		if (!version) return undefined

		const { rev, semver } = version
		const repoUrl = 'https://github.com/stumpapp/stump'
		if (semver && semver !== '0.0.0') {
			return `${repoUrl}/releases/tag/v${semver}`
		} else if (rev) {
			return `${repoUrl}/commit/${rev}`
		} else {
			return repoUrl
		}
	}, [version])

	if (!version) return null

	return (
		<Link
			href={url}
			target="__blank"
			rel="noopener noreferrer"
			className={cx('space-x-2 pl-2 flex items-center text-xxs', TEXT_VARIANTS.muted)}
			underline={false}
		>
			<span>
				v{version.semver}
				{!!version.rev && ` - ${version.rev}`}
			</span>
		</Link>
	)
}
