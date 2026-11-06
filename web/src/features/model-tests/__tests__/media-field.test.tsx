import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import '@/i18n/config'

import { MediaField } from '../media-field'
afterEach(cleanup)
it('reads a selected image and provides a removable preview', async () => {
  const change = vi.fn()
  const { rerender } = render(
    <MediaField kind='image' value='' onChange={change} />
  )
  fireEvent.change(screen.getByLabelText('Choose media file'), {
    target: {
      files: [new File(['test'], 'sample.png', { type: 'image/png' })],
    },
  })
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith('data:image/png;base64,dGVzdA==')
  )
  rerender(
    <MediaField
      kind='image'
      value='data:image/png;base64,dGVzdA=='
      onChange={change}
    />
  )
  expect(screen.getByRole('img', { name: 'Media preview' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(change).toHaveBeenLastCalledWith('')
})
it('rejects a video in the image field', () => {
  const change = vi.fn()
  render(<MediaField kind='image' value='' onChange={change} />)
  fireEvent.change(screen.getByLabelText('Choose media file'), {
    target: {
      files: [new File(['test'], 'sample.mp4', { type: 'video/mp4' })],
    },
  })
  expect(screen.getByRole('alert')).toHaveTextContent('6 MiB')
  expect(change).not.toHaveBeenCalled()
})
