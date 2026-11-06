import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useAccounts } from '@/features/accounts'
import { useSites } from '@/features/sites'
import { api } from '@/lib/api'
import { request } from '@/lib/api/transport'
import { toast } from '@/lib/toast'

import {
  planSchema,
  testKeys,
  testTypes,
  useSaveTestPlan,
  useTestHistory,
  useTestPlan,
  type TestPlan,
} from './api'
import type { modelTestsSearchSchema } from './search'
import { TestResultDetail } from './test-result-detail'

type Search = z.infer<typeof modelTestsSearchSchema>
const editorSchema = planSchema.extend({
  draftModel: z.string(),
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
      search: (previous) => ({ ...previous, ...patch, page: patch.page ?? 1 }),
      replace: true,
    })
  const plan = useTestPlan(),
    save = useSaveTestPlan(),
    accounts = useAccounts(),
    sites = useSites()
  const form = useForm<Editor>({
    resolver: zodResolver(editorSchema),
    defaultValues: { ...initialPlan, draftModel: '', draftType: 'text' },
  })
  const targets = useWatch({ control: form.control, name: 'targets' }) ?? []
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
      q: search.q,
      siteTag: search.siteTag,
      type: search.type,
      status: search.status,
      from: search.from,
      to: search.to,
      batchId: search.batchId,
      page: search.page,
    },
    busy
  )
  const siteMap = new Map((sites.data ?? []).map((site) => [site.id, site]))
  const accountMap = new Map(
    (accounts.data?.accounts ?? []).map((account) => [account.id, account])
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
  const addTargets = () => {
    const model = form.getValues('draftModel').trim(),
      type = form.getValues('draftType')
    if (!model || selected.length === 0) {
      toast.error(t('modelTests.chooseTarget'))
      return
    }
    const next = [...targets]
    for (const accountId of selected) {
      if (
        !next.some(
          (target) =>
            target.accountId === accountId &&
            target.model === model &&
            target.type === type
        )
      )
        next.push({ accountId, model, type })
    }
    form.setValue('targets', next, { shouldDirty: true, shouldValidate: true })
  }
  const submit = form.handleSubmit(async (values) => {
    const payload: TestPlan = planSchema.parse(values)
    await save.mutateAsync(payload)
    form.reset({
      ...payload,
      draftModel: form.getValues('draftModel'),
      draftType: form.getValues('draftType'),
    })
    toast.success(t('modelTests.saved'))
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
                name='draftModel'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modelTests.model')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
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
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    {['account', 'model', 'type', 'remove'].map((key) => (
                      <TableHead key={key}>{t(`modelTests.${key}`)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targets.map((target, index) => {
                    const account = accountMap.get(target.accountId)
                    return (
                      <TableRow
                        key={`${target.accountId}:${target.model}:${target.type}`}
                      >
                        <TableCell>
                          {siteMap.get(account?.siteId ?? 0)?.name} /{' '}
                          {account?.username ?? target.accountId}
                        </TableCell>
                        <TableCell>{target.model}</TableCell>
                        <TableCell>
                          {t(`modelTests.types.${target.type}`)}
                        </TableCell>
                        <TableCell>
                          <Button
                            type='button'
                            size='sm'
                            variant='ghost'
                            onClick={() =>
                              form.setValue(
                                'targets',
                                targets.filter((_, i) => i !== index),
                                { shouldDirty: true }
                              )
                            }
                          >
                            {t('modelTests.remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <h2 className='font-semibold'>{t('modelTests.content')}</h2>
            <p className='text-muted-foreground text-sm'>
              {t('modelTests.mediaHint')}
            </p>
            <div className='grid gap-4 md:grid-cols-2'>
              <FormField
                control={form.control}
                name='textPrompts'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modelTests.fields.textPrompts')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value.join('\n')}
                        onChange={(event) =>
                          field.onChange(event.target.value.split('\n'))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {(
                [
                  'imagePrompt',
                  'videoPrompt',
                  'codexPrompt',
                  'searchPrompt',
                  'imageMedia',
                  'videoMedia',
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
                      {name.endsWith('Media') || name.endsWith('Prompt') ? (
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
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'created',
                'account',
                'model',
                'type',
                'status',
                'latency',
                'response',
              ].map((key) => (
                <TableHead key={key}>{t(`modelTests.${key}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.data?.items.map((result) => (
              <TableRow key={result.id}>
                <TableCell>
                  {new Date(result.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {result.siteName} / {result.accountName}
                </TableCell>
                <TableCell>{result.model}</TableCell>
                <TableCell>{t(`modelTests.types.${result.type}`)}</TableCell>
                <TableCell>
                  {t(`modelTests.statuses.${result.status}`)}
                </TableCell>
                <TableCell>{result.latencyMs} ms</TableCell>
                <TableCell>
                  <Button
                    variant='link'
                    className='max-w-80 justify-start truncate'
                    onClick={() => setDetailId(result.id)}
                  >
                    {result.error || result.text || t('modelTests.detail')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!history.data?.items.length && (
        <p>
          {t(history.isLoading ? 'modelTests.loading' : 'modelTests.empty')}
        </p>
      )}
      <div className='flex items-center gap-3'>
        <Button
          variant='outline'
          disabled={search.page <= 1}
          onClick={() => update({ page: search.page - 1 })}
        >
          {t('modelTests.previous')}
        </Button>
        <span>
          {search.page} /{' '}
          {Math.max(1, Math.ceil((history.data?.total ?? 0) / 50))}
        </span>
        <Button
          variant='outline'
          disabled={search.page * 50 >= (history.data?.total ?? 0)}
          onClick={() => update({ page: search.page + 1 })}
        >
          {t('modelTests.next')}
        </Button>
      </div>
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
