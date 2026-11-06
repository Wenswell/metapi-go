import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function MediaField({
  kind,
  value,
  onChange,
  id,
  ...props
}: {
  kind: 'image' | 'video'
  value: string
  onChange: (value: string) => void
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const { t } = useTranslation()
  const fileId = useId()
  const [error, setError] = useState('')
  return (
    <div className='space-y-2'>
      <Input
        {...props}
        id={id}
        type='url'
        value={value.startsWith('data:') ? '' : value}
        placeholder='https://'
        onChange={(event) => {
          setError('')
          onChange(event.target.value)
        }}
      />
      <label htmlFor={fileId} className='text-sm'>
        {t('modelTests.uploadMedia')}
      </label>
      <Input
        id={fileId}
        type='file'
        accept={`${kind}/*`}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          if (
            !file.type.startsWith(`${kind}/`) ||
            file.size > 6 * 1024 * 1024
          ) {
            setError(t('modelTests.mediaSizeError'))
            return
          }
          const reader = new FileReader()
          reader.onload = () => {
            setError('')
            onChange(String(reader.result))
          }
          reader.onerror = () => setError(t('modelTests.mediaReadError'))
          reader.readAsDataURL(file)
          event.target.value = ''
        }}
      />
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {value && (
        <>
          {kind === 'image' ? (
            <img
              src={value}
              alt={t('modelTests.mediaPreview')}
              className='max-h-48 max-w-full rounded-md object-contain'
            />
          ) : (
            <video
              src={value}
              controls
              preload='metadata'
              aria-label={t('modelTests.mediaPreview')}
              className='max-h-60 max-w-full rounded-md'
            >
              <track kind='captions' />
            </video>
          )}
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => onChange('')}
          >
            {t('modelTests.remove')}
          </Button>
        </>
      )}
    </div>
  )
}
