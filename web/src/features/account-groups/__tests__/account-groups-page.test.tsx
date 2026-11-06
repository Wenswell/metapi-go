import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import '@/i18n/config'
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }))

import { AccountGroupsPage } from '../account-groups-page'
const mock = vi.hoisted(() => ({ request: vi.fn(), getTask: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({
    q: '',
    siteTag: '公益',
    platform: '',
    capability: 'all',
    sort: 'rate',
  }),
  useLocation: (options?: {
    select?: (location: { pathname: string; searchStr: string }) => unknown
  }) => {
    const location = { pathname: '/account-groups', searchStr: '' }
    return options?.select ? options.select(location) : location
  },
  useNavigate: () => vi.fn(),
}))
vi.mock('@/lib/api/transport', async (original) => ({
  ...(await original<typeof import('@/lib/api/transport')>()),
  request: mock.request,
}))
vi.mock('@/lib/api', () => ({
  api: {
    getTask: mock.getTask,
    getSites: async () => [
      { id: 1, name: 'Public site', tags: ['公益'] },
      { id: 2, name: 'Paid site', tags: ['付费'] },
    ],
    getAccountsSnapshot: async () => ({
      accounts: [
        { id: 7, siteId: 1, username: 'public-user' },
        { id: 8, siteId: 2, username: 'paid-user' },
      ],
      sites: [],
    }),
  },
}))
afterEach(cleanup)
it('shows filtered group pricing and refresh errors, and refreshes only matching accounts', async () => {
  mock.request.mockImplementation(async (url: string) =>
    url.endsWith('/refresh')
      ? { taskId: 'task-1' }
      : [
          {
            accountId: 7,
            groups: [
              {
                id: 'g1',
                name: 'Public group',
                description: 'shared access',
                platform: 'openai',
                rate: 0.5,
                imagePrice1k: null,
                imagePrice2k: 0.2,
                video: true,
              },
            ],
            fetchedAt: '2026-11-06T00:00:00Z',
            attemptedAt: '2026-11-06T01:00:00Z',
            error: 'expired session',
          },
          {
            accountId: 8,
            groups: [
              {
                id: 'g2',
                name: 'Paid group',
                description: 'paid',
                platform: 'openai',
                rate: 2,
                imagePrice1k: null,
                imagePrice2k: null,
                video: false,
              },
            ],
            fetchedAt: '',
            attemptedAt: '',
            error: '',
          },
        ]
  )
  mock.getTask.mockResolvedValue({ task: { status: 'succeeded' } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AccountGroupsPage />
    </QueryClientProvider>
  )
  expect(await screen.findByText('Public group')).toBeInTheDocument()
  expect(screen.getByText('0.5')).toBeInTheDocument()
  expect(screen.getByText('expired session')).toBeInTheDocument()
  expect(screen.queryByText('Paid group')).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh filtered accounts' })
  )
  await waitFor(() =>
    expect(mock.request).toHaveBeenCalledWith('/api/account-groups/refresh', {
      method: 'POST',
      body: JSON.stringify({ accountIds: [7] }),
    })
  )
  client.clear()
})
