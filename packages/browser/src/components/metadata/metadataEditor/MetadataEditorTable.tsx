import { Card, cn } from '@longbox/components'
import {
	ColumnDef,
	flexRender,
	getCoreRowModel,
	RowData,
	useReactTable,
} from '@tanstack/react-table'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useWindowSize } from 'rooks'

import { calculateOptimalColumnWidth, calculateTableSizing } from './utils'

type Props<Item> = {
	columns: ColumnDef<Item>[]
	items: Item[]
	showMissing: boolean
}

// The editor controls (Edit / Save / Cancel) deliberately live *outside* this table, rendered
// above it by the owning editor. They used to be the header of a right-pinned `actions` column
// declared `size: 0`: a zero-width `position: sticky` cell with a real button inside it, whose
// content therefore overflowed its own box at `z-index: 1` and painted on top of the adjacent
// cells. On a desktop viewport the slack in the width arithmetic hid that; at phone and tablet
// widths the buttons landed squarely on the field values.

export default function MetadataEditorTable<Item extends RowData>({
	columns,
	items,
	showMissing,
}: Props<Item>) {
	const table = useReactTable({
		columns,
		data: items,
		getCoreRowModel: getCoreRowModel(),
		columnResizeMode: 'onChange',
		state: {
			expanded: {
				missing: showMissing,
			},
		},
		defaultColumn: {
			size: 120,
		},
	})

	const windowDimensions = useWindowSize()
	const tableContainerRef = useRef<HTMLDivElement>(null)
	const tableRef = useRef<HTMLTableElement>(null)

	useLayoutEffect(() => {
		if (!tableContainerRef.current) return
		const resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry) {
				const initialColumnSizing = calculateTableSizing(
					table.getFlatHeaders(),
					entry.contentRect.width,
				)
				table.setColumnSizing(initialColumnSizing)
			}
		})
		resizeObserver.observe(tableContainerRef.current)
		return () => {
			resizeObserver.disconnect()
		}
	}, [table, windowDimensions.innerWidth])

	const ensureResizeFillsSpace = useCallback(
		(headerId: string, adjustedWidth: number) => {
			if (tableContainerRef.current === null) {
				table.setColumnSizing((prev) => ({
					...prev,
					[headerId]: adjustedWidth,
				}))
			} else {
				const adjustedHeaders = table.getFlatHeaders().map((header) => {
					if (header.id === headerId) {
						return {
							...header,
							size: adjustedWidth,
						}
					}
					return header
				})
				const adjustedSize = calculateTableSizing(
					adjustedHeaders,
					tableContainerRef.current.clientWidth,
				)
				table.setColumnSizing(adjustedSize)
			}
		},
		[table],
	)

	const { rows } = table.getRowModel()

	return (
		<Card
			// `overflow-x-auto`, not `overflow-hidden`: when the resolved column widths exceed the
			// container (a narrow viewport, or a value that refuses to wrap) the overflow has to be
			// reachable. Clipping it silently truncated the right-hand column instead.
			className="overflow-x-auto rounded-xl border-border bg-background"
			ref={tableContainerRef}
			style={{
				direction: table.options.columnResizeDirection,
				width: '100%',
			}}
		>
			<table
				className="w-fit divide-y divide-border"
				style={{
					width: table.getCenterTotalSize(),
				}}
				ref={tableRef}
			>
				<thead>
					<tr className="relative flex w-full">
						{table.getFlatHeaders().map((header) => (
							<th
								key={header.id}
								{...{
									colSpan: header.colSpan,
									style: {
										width: header.getSize(),
									},
								}}
								className="min-h-10 min-w-0 relative bg-card/70"
							>
								{flexRender(header.column.columnDef.header, header.getContext())}

								{header.column.getCanResize() && (
									<div
										onMouseDown={header.getResizeHandler()}
										onTouchStart={header.getResizeHandler()}
										onDoubleClick={() => {
											const optimalWidth = calculateOptimalColumnWidth(header.column.id)
											ensureResizeFillsSpace(header.column.id, optimalWidth)
										}}
										className={cn(
											'top-0 absolute -right-px z-50 h-full w-px cursor-col-resize touch-none opacity-0 transition-opacity duration-75 hover:opacity-50',
											{
												'opacity-100': header.column.getIsResizing(),
											},
											{
												'bg-foreground': !header.column.getIsResizing(),
											},
										)}
									/>
								)}
							</th>
						))}
					</tr>
				</thead>

				<tbody className="divide-y divide-border">
					{rows.map((row) => (
						// `w-full`, not `w-fit`: a `w-fit` row sizes to its content, so any cell
						// whose value did not fit made that row wider than the header row and
						// knocked the two out of alignment.
						<tr key={row.id} className="group/row flex w-full">
							{row.getVisibleCells().map((cell) => (
								<td
									// `min-w-0` matters: these are flex items, which default to
									// `min-width: auto` and so refuse to shrink below their content's
									// intrinsic width -- one long identifier or URL was enough to push
									// the row past the table width.
									className="py-2 pl-1.5 pr-1.5 first:pl-4 min-w-0 break-words first:border-r first:border-border"
									key={cell.id}
									style={{
										width: cell.column.getSize(),
									}}
								>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}

					{!rows.length && (
						<tr>
							<td colSpan={2}>
								<div className="h-32 flex items-center justify-center">No Metadata</div>
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</Card>
	)
}
