import { Badge, Link } from '@longbox/components'
import { Tag } from '@longbox/graphql'
import { Fragment } from 'react'

type Props = {
	tag: Tag
	href?: string
}

export default function TagComponent({ tag, href }: Props) {
	const Container = href ? Link : Fragment
	const containerProps = href ? { href, underline: false } : {}

	return (
		<Container {...containerProps}>
			<Badge variant="secondary" rounded="full" className={href ? 'cursor-pointer' : undefined}>
				{tag.name}
			</Badge>
		</Container>
	)
}
