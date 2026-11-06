import { useLocation } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'

import {
  DataTableColumnHeader,
  DataTablePage,
  encodeSorting,
  useDataTable,
  useUrlTableState,
} from '@/components/data-table'

/** Shared list behavior for the management screens, using the existing table owner. */
export function ManagementTable<T>({
  name,
  data,
  columns,
  loading = false,
  serverTotal,
}: {
  name: string
  data: T[]
  columns: ColumnDef<T>[]
  serverTotal?: number
  loading?: boolean
}) {
  const pathname = useLocation({ select: (location) => location.pathname })
  const read = (search: string) => {
    const params = new URLSearchParams(search)
    const sorting = (params.get(`${name}Sort`) ?? '')
      .split(',')
      .filter(Boolean)
      .map((part) => {
        const [id, direction] = part.split(':')
        return { id, desc: direction === 'desc' }
      })
    return {
      q: params.get(`${name}Q`) ?? '',
      pageIndex: Math.max(0, Number(params.get(`${name}Page`) ?? 1) - 1),
      pageSize: Number(params.get(`${name}Size`) ?? 20),
      sorting,
      filters: {},
    }
  }
  const state = useUrlTableState({
    basePath: pathname,
    read,
    buildHref: (next, search) => {
      const params = new URLSearchParams(search)
      if (next.q !== undefined) params.set(`${name}Q`, next.q)
      if (next.pageIndex !== undefined)
        params.set(`${name}Page`, String(next.pageIndex + 1))
      if (next.pageSize !== undefined)
        params.set(`${name}Size`, String(next.pageSize))
      if (next.sorting !== undefined)
        params.set(`${name}Sort`, encodeSorting(next.sorting))
      return `${pathname}?${params}`
    },
    toColumnFilters: () => [],
    fromColumnFilters: () => ({}),
    resetPageIndexOnFilterChange: true,
  })
  const sortableColumns = useMemo(
    () =>
      columns.map((column) => {
        if (typeof column.header !== 'string' || column.enableSorting === false)
          return column
        const label = column.header
        return {
          ...column,
          id:
            column.id ??
            ('accessorKey' in column ? String(column.accessorKey) : label),
          meta: { ...column.meta, label },
          header: ({ column: owner }) => (
            <DataTableColumnHeader column={owner} title={label} />
          ),
        } satisfies ColumnDef<T>
      }),
    [columns]
  )
  const { table } = useDataTable({
    data,
    autoResetPageIndex: false,
    columns: sortableColumns,
    ...state,
    manualPagination: serverTotal !== undefined,
    manualSorting: serverTotal !== undefined,
    manualFiltering: serverTotal !== undefined,
    totalCount: serverTotal,
    columnVisibilityStorageKey: `metapi.${name}.columns`,
    columnSizingStorageKey: `metapi.${name}.widths`,
  })
  return <DataTablePage table={table} isLoading={loading} toolbarProps={{}} />
}
