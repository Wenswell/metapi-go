import { zodResolver } from '@hookform/resolvers/zod'
import {
  useMutation,
  useQuery,
  useQueryClient,
  useQueries,
} from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useState, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ManagementTable } from '@/components/common/management-table'
import { PageHeader } from '@/components/common/page-header'
import { SiteTagFilter } from '@/components/common/site-tag-filter'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAccounts, accountModelsQueryOptions } from '@/features/accounts'
import { useSites } from '@/features/sites'
import { api } from '@/lib/api'
import { request } from '@/lib/api/transport'
import { toast } from '@/lib/toast'

import {
  planSchema,
  type resultSchema,
  testKeys,
  testTypes,
  useSaveTestPlan,
  useTestHistory,
  useTestPlan,
  type TestPlan,
} from './api'
import { MediaField } from './media-field'
import type { modelTestsSearchSchema } from './search'
import { TestResultDetail } from './test-result-detail'

const EMPTY_TARGETS: TestPlan['targets'] = []
const EMPTY_HISTORY: z.infer<typeof resultSchema>[] = []
type Search = z.infer<typeof modelTestsSearchSchema>
const editorSchema = planSchema.extend({
  draftModels: z.array(z.string()),
  draftType: z.enum(testTypes),
})
type Editor = z.infer<typeof editorSchema>

export function ModelTestsPage() {
  const { t } = useTranslation()
  const plan = useTestPlan()
  if (!plan.data)
    return (
      <div className='space-y-4 p-4 md:p-6'>
        <PageHeader title={t('modelTests.title')} />
        {plan.error ? (
          <p role='alert' className='text-destructive'>
            {String(plan.error)}
          </p>
        ) : (
          <p>{t('modelTests.loading')}</p>
        )}
      </div>
    )
  return <ModelTestsEditor initialPlan={plan.data} />
}

function ModelTestsEditor({ initialPlan }: { initialPlan: TestPlan }) {
  const { t } = useTranslation()
  const search = useSearch({ from: '/_authenticated/model-tests' })
  const navigate = useNavigate({ from: '/model-tests' })
  const update = (patch: Partial<Search>) =>
    void navigate({
      search: (previous) => ({
        ...previous,
        ...patch,
        testHistoryPage: patch.testHistoryPage ?? 1,
      }),
      replace: true,
    })
  const plan = useTestPlan(),
    save = useSaveTestPlan(),
    accounts = useAccounts(),
    sites = useSites()
  const form = useForm<Editor>({
    resolver: zodResolver(editorSchema),
    defaultValues: { ...initialPlan, draftModels: [], draftType: 'text' },
  })
  const textPrompts = useWatch({ control: form.control, name: 'textPrompts' })

  const targets =
    useWatch({ control: form.control, name: 'targets' }) ?? EMPTY_TARGETS
  const [selected, setSelected] = useState<number[]>([])
  const [taskId, setTaskId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const client = useQueryClient()
  const task = useQuery({
    queryKey: ['model-tests', 'task', taskId],
    enabled: taskId !== null,
    queryFn: async () => {
      if (taskId === null) throw new Error('Missing task ID')
      const response = (await api.getTask(taskId)) as {
        task: { status: string; error?: string; result?: { batchId?: string } }
      }
      if (['succeeded', 'failed'].includes(response.task.status))
        await client.invalidateQueries({ queryKey: testKeys.history })
      return response.task
    },
    refetchInterval: (query) =>
      query.state.data &&
      ['succeeded', 'failed'].includes(query.state.data.status)
        ? false
        : 1000,
  })
  const run = useMutation({
    mutationFn: () =>
      request<{ taskId: string }>('/api/model-tests/run', { method: 'POST' }),
    onSuccess: (result) => setTaskId(result.taskId),
  })
  const busy =
    run.isPending ||
    (taskId !== null &&
      !['succeeded', 'failed'].includes(task.data?.status ?? ''))
  const history = useTestHistory(
    {
      q: [search.q, search.testHistoryQ].filter(Boolean).join(' '),
      siteTag: search.siteTag,
      type: search.type,
      status: search.status,
      from: search.from,
      to: search.to,
      batchId: search.batchId,
      page: search.testHistoryPage,
      pageSize: search.testHistorySize,
      sort: search.testHistorySort,
    },
    busy
  )
  const siteMap = useMemo(
    () => new Map((sites.data ?? []).map((site) => [site.id, site])),
    [sites.data]
  )
  const accountMap = useMemo(
    () =>
      new Map(
        (accounts.data?.accounts ?? []).map((account) => [account.id, account])
      ),
    [accounts.data]
  )
  const tags = (sites.data ?? []).flatMap((site) => site.tags ?? [])
  const candidates = (accounts.data?.accounts ?? []).filter((account) => {
    const site = siteMap.get(account.siteId)
    return (
      (!search.targetTag || site?.tags?.includes(search.targetTag)) &&
      [site?.name, site?.url, account.username]
        .join(' ')
        .toLowerCase()
        .includes(search.targetQ.toLowerCase())
    )
  })
  const modelQueries = useQueries({
    queries: selected.map(accountModelsQueryOptions),
  })
  const modelChoices = [
    ...new Set(
      modelQueries.flatMap((query) =>
        (query.data?.models ?? [])
          .filter((model) => model.available && !model.disabled)
          .map((model) => model.name)
      )
    ),
  ].sort()
  const addTargets = () => {
    const models = form.getValues('draftModels'),
      type = form.getValues('draftType')
    if (!models.length || !selected.length) {
      toast.error(t('modelTests.chooseTarget'))
      return
    }
    const next = [...targets]
    selected.forEach((accountId, index) => {
      const available = modelQueries[index].data?.models ?? []
      for (const model of models) {
        if (
          !available.some(
            (entry) =>
              entry.name === model && entry.available && !entry.disabled
          )
        )
          continue
        if (
          !next.some(
            (entry) =>
              entry.accountId === accountId &&
              entry.model === model &&
              entry.type === type
          )
        )
          next.push({ accountId, model, type })
      }
    })
    form.setValue('targets', next, { shouldDirty: true, shouldValidate: true })
  }
  const submit = form.handleSubmit(async (values) => {
    const payload: TestPlan = planSchema.parse(values)
    await save.mutateAsync(payload)
    form.reset({
      ...payload,
      draftModels: form.getValues('draftModels'),
      draftType: form.getValues('draftType'),
    })
    toast.success(t('modelTests.saved'))
  })
  const targetRows = useMemo(
    () =>
      targets.map((target) => {
        const account = accountMap.get(target.accountId)
        return {
          ...target,
          account: `${siteMap.get(account?.siteId ?? 0)?.name ?? ''} / ${account?.username ?? target.accountId}`,
        }
      }),
    [targets, accountMap, siteMap]
  )
  const targetColumns = useMemo<ColumnDef<(typeof targetRows)[number]>[]>(
    () => [
      { accessorKey: 'account', header: t('modelTests.account') },
      { accessorKey: 'model', header: t('modelTests.model') },
      {
        accessorKey: 'type',
        header: t('modelTests.type'),
        cell: ({ row }) => t(`modelTests.types.${row.original.type}`),
      },
      {
        id: 'remove',
        header: t('modelTests.remove'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              form.setValue(
                'targets',
                targets.filter(
                  (target) =>
                    !(
                      target.accountId === row.original.accountId &&
                      target.model === row.original.model &&
                      target.type === row.original.type
                    )
                ),
                { shouldDirty: true }
              )
            }
          >
            {t('modelTests.remove')}
          </Button>
        ),
      },
    ],
    [t, targets, form]
  )
  const historyColumns = useMemo<ColumnDef<z.infer<typeof resultSchema>>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: t('modelTests.created'),
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
      },
      {
        id: 'account',
        accessorFn: (row) => `${row.siteName} / ${row.accountName}`,
        header: t('modelTests.account'),
      },
      { accessorKey: 'model', header: t('modelTests.model') },
      {
        accessorKey: 'type',
        header: t('modelTests.type'),
        cell: ({ row }) => t(`modelTests.types.${row.original.type}`),
      },
      {
        accessorKey: 'status',
        header: t('modelTests.status'),
        cell: ({ row }) => t(`modelTests.statuses.${row.original.status}`),
      },
      { accessorKey: 'latencyMs', header: t('modelTests.latency') },
      {
        accessorKey: 'text',
        header: t('modelTests.response'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            type='button'
            variant='link'
            className='max-w-80 truncate'
            onClick={() => setDetailId(row.original.id)}
          >
            {row.original.error || row.original.text || t('modelTests.detail')}
          </Button>
        ),
      },
    ],
    [t]
  )
  const [newsPreview, setNewsPreview] = useState('')
  const news = useMutation({
    mutationFn: () =>
      request<{ digest: string }>(
        `/api/model-tests/news-preview?source=${form.getValues('newsSource')}`
      ),
    onSuccess: (data) => setNewsPreview(data.digest),
  })
  const errors = [
    plan.error,
    accounts.error,
    sites.error,
    history.error,
    task.error,
  ].filter(Boolean)
  return (
    <div className='flex flex-col gap-4 p-4 md:p-6'>
      <PageHeader
        title={t('modelTests.title')}
        description={t('modelTests.description')}
        actions={
          <Button
            disabled={
              busy ||
              save.isPending ||
              form.formState.isDirty ||
              !plan.data?.targets.length
            }
            onClick={() => run.mutate()}
          >
            {t(busy ? 'modelTests.running' : 'modelTests.run')}
          </Button>
        }
      />
      {errors.length > 0 && (
        <p role='alert' className='text-destructive'>
          {errors.map(String).join('; ')}
        </p>
      )}
      {task.data?.error && (
        <p role='alert' className='text-destructive'>
          {task.data.error}
        </p>
      )}
      {task.data?.result?.batchId && (
        <Button
          variant='link'
          className='self-start'
          onClick={() => update({ batchId: task.data?.result?.batchId ?? '' })}
        >
          {t('modelTests.viewBatch')}
        </Button>
      )}
      {plan.isLoading && <p>{t('modelTests.loading')}</p>}
      {plan.data && (
        <Form {...form}>
          <form onSubmit={submit} className='space-y-4 rounded-md border p-4'>
            <h2 className='font-semibold'>{t('modelTests.targets')}</h2>
            <div className='flex flex-wrap gap-2'>
              <Input
                className='w-72'
                aria-label={t('modelTests.targetSearch')}
                placeholder={t('modelTests.targetSearch')}
                value={search.targetQ}
                onChange={(event) => update({ targetQ: event.target.value })}
              />
              <SiteTagFilter
                tags={tags}
                value={search.targetTag}
                onChange={(targetTag) => update({ targetTag })}
              />
              <Button
                type='button'
                variant='outline'
                onClick={() =>
                  setSelected(candidates.map((account) => account.id))
                }
              >
                {t('modelTests.selectFiltered')}
              </Button>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setSelected([])}
              >
                {t('modelTests.clearSelection')}
              </Button>
            </div>
            <div className='grid max-h-52 gap-2 overflow-y-auto md:grid-cols-2'>
              {candidates.map((account) => (
                <label
                  key={account.id}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={selected.includes(account.id)}
                    onCheckedChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [...previous, account.id]
                          : previous.filter((id) => id !== account.id)
                      )
                    }
                  />
                  {siteMap.get(account.siteId)?.name} /{' '}
                  {account.username ?? account.id}
                </label>
              ))}
            </div>
            <div className='flex flex-wrap items-end gap-2'>
              <FormField
                control={form.control}
                name='draftModels'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modelTests.model')}</FormLabel>
                    <div
                      className='grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3'
                      role='group'
                      aria-label={t('modelTests.model')}
                    >
                      {modelChoices.map((model) => (
                        <label
                          key={model}
                          className='flex items-center gap-2 text-sm'
                        >
                          <Checkbox
                            checked={field.value.includes(model)}
                            onCheckedChange={(checked) =>
                              field.onChange(
                                checked
                                  ? [...field.value, model]
                                  : field.value.filter((name) => name !== model)
                              )
                            }
                          />
                          {model}
                        </label>
                      ))}
                      {!modelChoices.length && (
                        <p className='text-muted-foreground text-sm'>
                          {t(
                            modelQueries.some((query) => query.isLoading)
                              ? 'modelTests.loading'
                              : 'modelTests.noModels'
                          )}
                        </p>
                      )}
                      {modelQueries
                        .filter((query) => query.error)
                        .map((query, index) => (
                          <p
                            key={index}
                            role='alert'
                            className='text-destructive'
                          >
                            {String(query.error)}
                          </p>
                        ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='draftType'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modelTests.type')}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue>
                            {t(`modelTests.types.${field.value}`)}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {testTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {t(`modelTests.types.${type}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type='button' variant='outline' onClick={addTargets}>
                {t('modelTests.addTargets', { count: selected.length })}
              </Button>
            </div>
            <FormField
              control={form.control}
              name='targets'
              render={() => (
                <FormItem>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ManagementTable
              name='testTargets'
              data={targetRows}
              columns={targetColumns}
            />
            <h2 className='font-semibold'>{t('modelTests.content')}</h2>
            <p className='text-muted-foreground text-sm'>
              {t('modelTests.mediaHint')}
            </p>
            <FormField
              control={form.control}
              name='newsSource'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('modelTests.newsSource')}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value)
                      setNewsPreview('')
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue>
                          {field.value === 'spaceflight'
                            ? 'Spaceflight News API'
                            : 'Hacker News RSS'}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value='rss'>
                        Hacker News RSS · https://hnrss.org/frontpage
                      </SelectItem>
                      <SelectItem value='spaceflight'>
                        Spaceflight ·
                        https://api.spaceflightnewsapi.net/v4/articles/?limit=20
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className='text-muted-foreground text-sm'>
              {t('modelTests.newsHint')}
            </p>
            <Button
              type='button'
              variant='outline'
              disabled={news.isPending}
              onClick={() => news.mutate()}
            >
              {t('modelTests.newsPreview')}
            </Button>
            {news.error && (
              <p role='alert' className='text-destructive'>
                {String(news.error)}
              </p>
            )}
            {newsPreview && (
              <pre className='max-h-64 overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap'>
                {newsPreview}
              </pre>
            )}
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-3 md:col-span-2'>
                <p className='text-sm font-medium'>
                  {t('modelTests.fields.textPrompts')}
                </p>
                <p className='text-muted-foreground text-sm'>
                  {t('modelTests.textPromptsHint')}
                </p>
                {textPrompts.map((_, index) => (
                  <FormField
                    key={index}
                    control={form.control}
                    name={`textPrompts.${index}`}
                    render={({ field }) => (
                      <FormItem>
                        <div className='flex items-center justify-between gap-2'>
                          <FormLabel>
                            {t('modelTests.textRound', { count: index + 1 })}
                          </FormLabel>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={textPrompts.length === 1}
                            aria-label={t('modelTests.removeTextRound', {
                              count: index + 1,
                            })}
                            onClick={() =>
                              form.setValue(
                                'textPrompts',
                                textPrompts.filter(
                                  (_, current) => current !== index
                                ),
                                { shouldDirty: true, shouldValidate: true }
                              )
                            }
                          >
                            {t('modelTests.remove')}
                          </Button>
                        </div>
                        <FormControl>
                          <Textarea {...field} rows={4} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
                <Button
                  type='button'
                  variant='outline'
                  onClick={() =>
                    form.setValue('textPrompts', [...textPrompts, ''], {
                      shouldDirty: true,
                    })
                  }
                >
                  {t('modelTests.addTextRound')}
                </Button>
              </div>
              {(
                [
                  'systemPrompt',
                  'videoSystemPrompt',
                  'codexSystemPrompt',
                  'imagePrompt',
                  'videoPrompt',
                  'codexPrompt',
                  'searchPrompt',
                  'cron',
                  'timezone',
                ] as const
              ).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(`modelTests.fields.${name}`)}</FormLabel>
                      {name.endsWith('Prompt') ? (
                        <FormControl>
                          <Textarea {...field} />
                        </FormControl>
                      ) : (
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              {(['imageMedia', 'videoMedia'] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(`modelTests.fields.${name}`)}</FormLabel>
                      <FormControl>
                        <MediaField
                          kind={name === 'imageMedia' ? 'image' : 'video'}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              {(['timeoutSeconds', 'maxOutputTokens'] as const).map((name) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t(`modelTests.fields.${name}`)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          onChange={(event) =>
                            field.onChange(Number(event.target.value))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
              <FormField
                control={form.control}
                name='scheduleEnabled'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('modelTests.fields.scheduleEnabled')}
                    </FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className='text-muted-foreground text-sm'>
              {t('modelTests.scheduleHint')}
            </p>
            <Button type='submit' disabled={save.isPending || busy}>
              {t('modelTests.save')}
            </Button>
          </form>
        </Form>
      )}
      <h2 className='font-semibold'>{t('modelTests.history')}</h2>
      <div className='flex flex-wrap gap-2'>
        <Input
          className='w-72'
          value={search.q}
          aria-label={t('modelTests.search')}
          placeholder={t('modelTests.search')}
          onChange={(event) => update({ q: event.target.value })}
        />
        <SiteTagFilter
          tags={tags}
          value={search.siteTag}
          onChange={(siteTag) => update({ siteTag })}
        />
        <Select
          value={search.type}
          onValueChange={(value) =>
            update({ type: (value ?? '') as Search['type'] })
          }
        >
          <SelectTrigger aria-label={t('modelTests.type')}>
            <SelectValue>
              {search.type
                ? t(`modelTests.types.${search.type}`)
                : t('modelTests.allTypes')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=''>{t('modelTests.allTypes')}</SelectItem>
            {testTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`modelTests.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.status}
          onValueChange={(value) =>
            update({ status: (value ?? '') as Search['status'] })
          }
        >
          <SelectTrigger aria-label={t('modelTests.status')}>
            <SelectValue>
              {search.status
                ? t(`modelTests.statuses.${search.status}`)
                : t('modelTests.allStatuses')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=''>{t('modelTests.allStatuses')}</SelectItem>
            {(['passed', 'partial', 'failed'] as const).map((status) => (
              <SelectItem key={status} value={status}>
                {t(`modelTests.statuses.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className='text-sm'>
          {t('modelTests.from')}
          <Input
            type='date'
            value={search.from}
            onChange={(event) => update({ from: event.target.value })}
          />
        </label>
        <label className='text-sm'>
          {t('modelTests.to')}
          <Input
            type='date'
            value={search.to}
            onChange={(event) => update({ to: event.target.value })}
          />
        </label>
        {search.batchId && (
          <Button variant='outline' onClick={() => update({ batchId: '' })}>
            {t('modelTests.clearBatch')}
          </Button>
        )}
        <Button variant='outline' onClick={() => void history.refetch()}>
          {t('modelTests.refresh')}
        </Button>
      </div>
      <ManagementTable
        name='testHistory'
        data={history.data?.items ?? EMPTY_HISTORY}
        columns={historyColumns}
        loading={history.isLoading}
        serverTotal={history.data?.total ?? 0}
      />
      <Dialog
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>{t('modelTests.detail')}</DialogTitle>
          </DialogHeader>
          {detailId && <TestResultDetail id={detailId} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
