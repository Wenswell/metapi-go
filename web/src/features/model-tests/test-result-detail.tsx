import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { request } from '@/lib/api/transport'

import { resultSchema } from './api'

const detailSchema = z.object({
  input: z.object({
    systemPrompt: z.string().optional(),
    prompts: z.array(z.string()),
    media: z.string(),
    maxOutputTokens: z.number(),
  }),
  rounds: z.array(
    z.object({
      prompt: z.string(),
      text: z.string(),
      error: z.string(),
      latencyMs: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
    })
  ),
})
export function TestResultDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const result = useQuery({
    queryKey: ['model-tests', 'detail', id],
    queryFn: async () => {
      const row = resultSchema.parse(
        await request(`/api/model-tests/history/${id}`)
      )
      return {
        ...row,
        parsedDetail: detailSchema.parse(JSON.parse(row.detail)),
      }
    },
  })
  if (result.error)
    return (
      <p role='alert' className='text-destructive'>
        {String(result.error)}
      </p>
    )
  if (!result.data) return <p>{t('modelTests.loading')}</p>
  const row = result.data
  return (
    <div className='space-y-4'>
      <p>
        {row.siteName} / {row.accountName} / {row.model} /{' '}
        {t(`modelTests.types.${row.type}`)}
      </p>
      <p className='text-muted-foreground text-sm'>
        {new Date(row.createdAt).toLocaleString()} ·{' '}
        {t(`modelTests.statuses.${row.status}`)} · {row.latencyMs} ms ·{' '}
        {row.source} · {row.batchId}
      </p>
      {row.error && (
        <p role='alert' className='text-destructive whitespace-pre-wrap'>
          {row.error}
        </p>
      )}
      {row.parsedDetail.input.systemPrompt && (
        <section className='rounded-md border p-3'>
          <h3 className='font-medium'>{t('modelTests.systemPrompt')}</h3>
          <p className='text-sm whitespace-pre-wrap'>
            {row.parsedDetail.input.systemPrompt}
          </p>
        </section>
      )}
      {row.parsedDetail.input.media && (
        <p className='text-muted-foreground text-sm break-all'>
          {t('modelTests.media')}:{' '}
          {row.parsedDetail.input.media.startsWith('data:')
            ? `${row.parsedDetail.input.media.slice(0, row.parsedDetail.input.media.indexOf(','))} (${row.parsedDetail.input.media.length} chars)`
            : row.parsedDetail.input.media}
        </p>
      )}
      {row.parsedDetail.rounds.map((round, index) => (
        <section
          key={`${index}:${round.prompt}`}
          className='space-y-2 rounded-md border p-3'
        >
          <h3 className='font-semibold'>
            {t('modelTests.round', { count: index + 1 })}
          </h3>
          <p className='text-muted-foreground text-sm'>
            {round.latencyMs} ms · {t('modelTests.inputTokens')}:{' '}
            {round.inputTokens} · {t('modelTests.outputTokens')}:{' '}
            {round.outputTokens}
          </p>
          <h4 className='text-sm font-medium'>{t('modelTests.prompt')}</h4>
          <p className='wrap-anywhere whitespace-pre-wrap'>{round.prompt}</p>
          <h4 className='text-sm font-medium'>{t('modelTests.response')}</h4>
          <pre className='bg-muted rounded-md p-3 text-sm wrap-anywhere whitespace-pre-wrap'>
            {round.error || round.text}
          </pre>
        </section>
      ))}
    </div>
  )
}
