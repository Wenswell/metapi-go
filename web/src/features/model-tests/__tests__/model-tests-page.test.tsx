import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import '@/i18n/config'

import { ModelTestsPage } from '../model-tests-page'

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  navigate: vi.fn(),
  search: {
    q: '',
    siteTag: '',
    type: '',
    status: '',
    from: '',
    to: '',
    batchId: '',
    page: 1,
    targetQ: '',
    targetTag: '公益',
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mock.search,
  useNavigate: () => mock.navigate,
}))
vi.mock('@/lib/api/transport', async (original) => ({
  ...(await original<typeof import('@/lib/api/transport')>()),
  request: mock.request,
}))
vi.mock('@/lib/api', () => ({
  api: {
    getTask: vi.fn(),
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
const plan = {
  targets: [{ accountId: 8, model: 'old-model', type: 'text' }],
  textPrompts: ['first'],
  imagePrompt: 'image',
  videoPrompt: 'video',
  codexPrompt: 'codex',
  searchPrompt: 'search',
  imageMedia: '',
  videoMedia: '',
  timeoutSeconds: 120,
  maxOutputTokens: 512,
  scheduleEnabled: false,
  cron: '0 9 * * *',
  timezone: 'Asia/Singapore',
}
afterEach(cleanup)
beforeEach(() => {
  mock.request.mockReset()
  mock.navigate.mockReset()
  mock.request.mockImplementation(
    async (url: string, options?: { method?: string }) => {
      if (url === '/api/model-tests/plan')
        return options?.method ? { success: true } : plan
      if (url.startsWith('/api/model-tests/history'))
        return { items: [], total: 0 }
      throw new Error(`unexpected ${url}`)
    }
  )
})
it('filters candidate accounts by site tag, preserves saved targets, and saves explicit targets', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelTestsPage />
    </QueryClientProvider>
  )
  const checkbox = await screen.findByRole('checkbox', {
    name: 'Public site / public-user',
  })
  expect(
    screen.queryByRole('checkbox', { name: 'Paid site / paid-user' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('old-model')).toBeInTheDocument()
  fireEvent.click(checkbox)
  fireEvent.change(screen.getByLabelText('Model'), {
    target: { value: 'new-model' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected accounts (1)' })
  )
  expect(screen.getByText('new-model')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Run saved plan' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
  await waitFor(() =>
    expect(mock.request).toHaveBeenCalledWith(
      '/api/model-tests/plan',
      expect.objectContaining({ method: 'PUT' })
    )
  )
  const savedCall = mock.request.mock.calls.find(
    ([url, options]) =>
      url === '/api/model-tests/plan' && options?.method === 'PUT'
  )
  expect(savedCall).toBeDefined()
  const options = savedCall?.[1]
  expect(JSON.parse(options.body).targets).toEqual([
    { accountId: 8, model: 'old-model', type: 'text' },
    { accountId: 7, model: 'new-model', type: 'text' },
  ])
  client.clear()
})
it('shows load errors without presenting an editable empty plan', async () => {
  mock.request.mockRejectedValue(new Error('test storage unavailable'))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelTestsPage />
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'test storage unavailable'
    )
  )
  expect(
    screen.queryByRole('button', { name: 'Save plan' })
  ).not.toBeInTheDocument()
  client.clear()
})
