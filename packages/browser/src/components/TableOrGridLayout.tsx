import { IconButton, ToolTip } from '@longbox/components'
import { InterfaceLayout } from '@longbox/graphql'
import { useLocaleContext } from '@longbox/i18n'
import { LayoutGrid, Table } from 'lucide-react'

type Props = {
	layout: InterfaceLayout
	setLayout: (layout: InterfaceLayout) => void
}

export default function TableOrGridLayout({ layout, setLayout }: Props) {
	const { t } = useLocaleContext()

	return (
		<div className="gap-1 flex shrink-0 items-center">
			<ToolTip content={t(getLocaleKey('gridLayout'))} size="sm">
				<IconButton
					variant="ghost"
					size="sm"
					className="hover:bg-accent"
					onClick={() => setLayout(InterfaceLayout.Grid)}
					disabled={layout === InterfaceLayout.Grid}
					aria-label={t(getLocaleKey('gridLayout'))}
				>
					<LayoutGrid className="h-4 w-4" />
				</IconButton>
			</ToolTip>

			<ToolTip content={t(getLocaleKey('tableLayout'))} size="sm" align="end">
				<IconButton
					variant="ghost"
					size="sm"
					className="hover:bg-accent"
					onClick={() => setLayout(InterfaceLayout.Table)}
					disabled={layout === InterfaceLayout.Table}
					aria-label={t(getLocaleKey('tableLayout'))}
				>
					<Table className="h-4 w-4" />
				</IconButton>
			</ToolTip>
		</div>
	)
}

const LOCALE_KEY = 'filters.buttons'
const getLocaleKey = (path: string) => `${LOCALE_KEY}.${path}`
