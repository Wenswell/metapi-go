// Behavior tests for #985: the sites list name and URL cells expose safe,
// keyboard-focusable external links while invalid stored URLs degrade to text.
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '@/i18n/config'

import {
  useSitesColumns,
  type SitesColumnActions,
} from '../components/sites-columns'
import type { Site } from '../types'

const noopActions: SitesColumnActions = {
  onEdit: () => {},
  onView: () => {},
  onToggleStatus: () => {},
  onTogglePin: () => {},
  onDelete: () => {},
}

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: 7,
    name: 'Primary site',
    url: 'https://primary.example',
    status: 'active',
    ...overrides,
  }
}

function renderLinkCells(site: Site, onRowClick = vi.fn()) {
  let renderedColumns: ReturnType<typeof useSitesColumns> = []

  function CellsHarness() {
    const columns = useSitesColumns(noopActions)
    renderedColumns = columns
    const renderCell = (columnId: 'name' | 'url') => {
      const column = columns.find((entry) => entry.id === columnId)
      if (!column?.cell) throw new Error(`${columnId} column cell missing`)
      const cell = column.cell as unknown as (context: {
        row: { original: Site }
      }) => ReactElement
      return cell({ row: { original: site } })
    }

    return (
      <div data-testid='row' onClick={onRowClick}>
        {renderCell('name')}
        {renderCell('url')}
      </div>
    )
  }

  return {
    ...render(<CellsHarness />),
    getColumns: () => renderedColumns,
    onRowClick,
  }
}

afterEach(() => cleanup())

describe('sites list name and URL actions', () => {
  it('opens details from the name and keeps the URL as an external link', () => {
    const onView = vi.spyOn(noopActions, 'onView')
    const site = makeSite()
    const { onRowClick } = renderLinkCells(site)
    fireEvent.click(screen.getByRole('button', { name: 'Primary site' }))
    expect(onView).toHaveBeenCalledWith(site)
    expect(onRowClick).not.toHaveBeenCalled()
    const link = screen.getByRole('link', { name: 'https://primary.example' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
  it('opens details even if the site URL cannot be linked', () => {
    renderLinkCells(makeSite({ url: 'javascript:alert(1)' }))
    expect(screen.getByRole('button', { name: 'Primary site' })).toBeEnabled()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
