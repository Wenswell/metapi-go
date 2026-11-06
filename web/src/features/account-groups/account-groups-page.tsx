import { useNavigate, useSearch } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { ManagementTable } from '@/components/common/management-table'
import { PageHeader } from '@/components/common/page-header'
import { SiteTagFilter } from '@/components/common/site-tag-filter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccounts } from '@/features/accounts'
import { useSites } from '@/features/sites'

import { useAccountGroups, useRefreshAccountGroups } from './api'
import type { accountGroupsSearchSchema } from './search'

type Search = z.infer<typeof accountGroupsSearchSchema>
export function AccountGroupsPage() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/_authenticated/account-groups' })
  const navigate = useNavigate({ from: '/account-groups' })
  const update = (patch: Partial<Search>) =>
    void navigate({
      search: (previous) => ({ ...previous, ...patch }),
      replace: true,
    })
  const sites = useSites()
  const accounts = useAccounts()
  const snapshots = useAccountGroups()
  const refresh = useRefreshAccountGroups()
  const siteMap = useMemo(
    () => new Map((sites.data ?? []).map((site) => [site.id, site])),
    [sites.data]
  )
  const snapshotMap = useMemo(
    () => new Map((snapshots.data ?? []).map((row) => [row.accountId, row])),
    [snapshots.data]
  )
  const candidates = (accounts.data?.accounts ?? []).filter((account) => {
    const site = siteMap.get(account.siteId)
    const snapshot = snapshotMap.get(account.id)
    const text = [
      site?.name,
      site?.url,
      account.username,
      ...(snapshot?.groups ?? []).flatMap((group) => [
        group.name,
        group.description,
        group.platform,
      ]),
    ]
      .join(' ')
      .toLowerCase()
    return (
      (!search.siteTag || site?.tags?.includes(search.siteTag)) &&
      text.includes(search.q.toLowerCase())
    )
  })
  const rows = candidates.flatMap((account) => {
    const site = siteMap.get(account.siteId)
    return (snapshotMap.get(account.id)?.groups ?? []).map((group) => ({
      account,
      site,
      group,
    }))
  })
  const platforms = [
    ...new Set(rows.map((row) => row.group.platform).filter(Boolean)),
  ].sort()
  const filtered = rows.filter(({ account, site, group }) => {
    const text = [
      site?.name,
      site?.url,
      account.username,
      group.name,
      group.description,
      group.platform,
    ]
      .join(' ')
      .toLowerCase()
    return (
      text.includes(search.q.toLowerCase()) &&
      (!search.platform || search.platform === group.platform) &&
      (search.capability === 'all' ||
        (search.capability === 'video'
          ? group.video
          : group.imagePrice1k !== null || group.imagePrice2k !== null))
    )
  })
  const refreshCandidates =
    search.platform || search.capability !== 'all'
      ? candidates.filter((account) =>
          filtered.some((row) => row.account.id === account.id)
        )
      : candidates
  const errors = [
    sites.error,
    accounts.error,
    snapshots.error,
    refresh.task.error,
  ].filter(Boolean)
  const groupRows = useMemo(
    () =>
      filtered.map(({ account, site, group }) => ({
        id: `${account.id}:${group.id}`,
        site: site?.name ?? '',
        account: account.username ?? String(account.id),
        name: group.name,
        platform: group.platform,
        rate: group.rate,
        capability: [
          group.video && t('accountGroups.capabilities.video'),
          group.imagePrice1k !== null && `1K: ${group.imagePrice1k}`,
          group.imagePrice2k !== null && `2K: ${group.imagePrice2k}`,
        ]
          .filter(Boolean)
          .join(' / '),
        detail: group.description,
      })),
    [filtered, t]
  )
  const groupColumns = useMemo<ColumnDef<(typeof groupRows)[number]>[]>(
    () =>
      [
        'site',
        'account',
        'name',
        'platform',
        'rate',
        'capability',
        'detail',
      ].map((key) => ({ accessorKey: key, header: t(`accountGroups.${key}`) })),
    [t]
  )
  const statusRows = useMemo(
    () =>
      refreshCandidates.map((account) => {
        const snapshot = snapshotMap.get(account.id)
        return {
          id: account.id,
          site: siteMap.get(account.siteId)?.name ?? '',
          account: account.username ?? String(account.id),
          updated: snapshot?.attemptedAt ?? '',
          detail:
            snapshot?.error ||
            (snapshot
              ? `${snapshot.groups.length} ${t('accountGroups.name')}`
              : t('accountGroups.notFetched')),
          lastSuccess: snapshot?.fetchedAt ?? '',
        }
      }),
    [refreshCandidates, snapshotMap, siteMap, t]
  )
  const statusColumns = useMemo<ColumnDef<(typeof statusRows)[number]>[]>(
    () => [
      ...['site', 'account', 'updated', 'detail', 'lastSuccess'].map((key) => ({
        accessorKey: key,
        header: t(`accountGroups.${key}`),
      })),
      {
        id: 'refresh',
        header: t('accountGroups.refresh'),
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size='sm'
            variant='outline'
            disabled={refresh.busy}
            onClick={() => refresh.mutate([row.original.id])}
          >
            {t('accountGroups.refresh')}
          </Button>
        ),
      },
    ],
    [t, refresh]
  )
  return (
    <div className='flex flex-col gap-4 p-4 md:p-6'>
      <PageHeader
        title={t('accountGroups.title')}
        description={t('accountGroups.description')}
        actions={
          <Button
            disabled={refresh.busy || refreshCandidates.length === 0}
            onClick={() =>
              refresh.mutate(refreshCandidates.map((account) => account.id))
            }
          >
            {t(
              refresh.busy
                ? 'accountGroups.refreshing'
                : 'accountGroups.refreshAll'
            )}
          </Button>
        }
      />
      {errors.length > 0 && (
        <p role='alert' className='text-destructive'>
          {errors.map(String).join('; ')}
        </p>
      )}
      {refresh.task.data?.error && (
        <p role='alert' className='text-destructive'>
          {refresh.task.data.error}
        </p>
      )}
      <div className='flex flex-wrap gap-2'>
        <Input
          className='w-72'
          aria-label={t('accountGroups.search')}
          placeholder={t('accountGroups.search')}
          value={search.q}
          onChange={(event) => update({ q: event.target.value })}
        />
        <SiteTagFilter
          tags={(sites.data ?? []).flatMap((site) => site.tags ?? [])}
          value={search.siteTag}
          onChange={(siteTag) => update({ siteTag })}
        />
        <Select
          value={search.platform}
          onValueChange={(value) => update({ platform: value ?? '' })}
        >
          <SelectTrigger aria-label={t('accountGroups.platform')}>
            <SelectValue>
              {search.platform || t('accountGroups.allPlatforms')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=''>{t('accountGroups.allPlatforms')}</SelectItem>
            {platforms.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {platform}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.capability}
          onValueChange={(value) =>
            update({ capability: value as Search['capability'] })
          }
        >
          <SelectTrigger aria-label={t('accountGroups.capability')}>
            <SelectValue>
              {t(`accountGroups.capabilities.${search.capability}`)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(['all', 'image', 'video'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`accountGroups.capabilities.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <details open className='rounded-md border p-4'>
        <summary className='cursor-pointer font-semibold'>
          {t('accountGroups.refreshStatus')}
        </summary>
        <ManagementTable
          name='groupStatus'
          data={statusRows}
          columns={statusColumns}
          loading={accounts.isLoading}
        />
      </details>
      <section className='space-y-3'>
        <h2 className='font-semibold'>{t('accountGroups.title')}</h2>
        <ManagementTable
          name='groupRows'
          data={groupRows}
          columns={groupColumns}
          loading={snapshots.isLoading}
        />
      </section>
    </div>
  )
}
