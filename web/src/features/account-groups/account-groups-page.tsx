import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  const siteMap = new Map((sites.data ?? []).map((site) => [site.id, site]))
  const snapshotMap = new Map(
    (snapshots.data ?? []).map((row) => [row.accountId, row])
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
  const filtered = rows
    .filter(({ account, site, group }) => {
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
    .sort((a, b) => {
      if (search.sort === 'rate' || search.sort === 'rate-desc') {
        if (a.group.rate === null) return b.group.rate === null ? 0 : 1
        if (b.group.rate === null) return -1
        return (
          (a.group.rate - b.group.rate) * (search.sort === 'rate-desc' ? -1 : 1)
        )
      }
      return (
        search.sort === 'site' ? (a.site?.name ?? '') : a.group.name
      ).localeCompare(
        search.sort === 'site' ? (b.site?.name ?? '') : b.group.name
      )
    })
  const errors = [
    sites.error,
    accounts.error,
    snapshots.error,
    refresh.task.error,
  ].filter(Boolean)
  return (
    <div className='flex flex-col gap-4 p-4 md:p-6'>
      <PageHeader
        title={t('accountGroups.title')}
        description={t('accountGroups.description')}
        actions={
          <Button
            disabled={refresh.busy || candidates.length === 0}
            onClick={() =>
              refresh.mutate(candidates.map((account) => account.id))
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
            <SelectValue />
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'image', 'video'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`accountGroups.capabilities.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.sort}
          onValueChange={(value) => update({ sort: value as Search['sort'] })}
        >
          <SelectTrigger aria-label={t('accountGroups.sort')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['name', 'rate', 'rate-desc', 'site'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {t(`accountGroups.sorts.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'site',
                'account',
                'name',
                'platform',
                'rate',
                'capability',
                'detail',
              ].map((key) => (
                <TableHead key={key}>{t(`accountGroups.${key}`)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(({ account, site, group }) => (
              <TableRow key={`${account.id}:${group.id}`}>
                <TableCell>{site?.name}</TableCell>
                <TableCell>{account.username ?? account.id}</TableCell>
                <TableCell>{group.name}</TableCell>
                <TableCell>{group.platform || '—'}</TableCell>
                <TableCell>{group.rate ?? '—'}</TableCell>
                <TableCell>
                  {[
                    group.video && t('accountGroups.capabilities.video'),
                    group.imagePrice1k !== null && `1K: ${group.imagePrice1k}`,
                    group.imagePrice2k !== null && `2K: ${group.imagePrice2k}`,
                  ]
                    .filter(Boolean)
                    .join(' / ') || '—'}
                </TableCell>
                <TableCell className='max-w-96 whitespace-normal'>
                  {group.description || '—'}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={7}>
                  {t(
                    snapshots.isLoading
                      ? 'accountGroups.loading'
                      : 'accountGroups.empty'
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <h2 className='font-semibold'>{t('accountGroups.refreshStatus')}</h2>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              {['site', 'account', 'updated', 'detail', 'refresh'].map(
                (key) => (
                  <TableHead key={key}>{t(`accountGroups.${key}`)}</TableHead>
                )
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates
              .filter((account) =>
                [siteMap.get(account.siteId)?.name, account.username]
                  .join(' ')
                  .toLowerCase()
                  .includes(search.q.toLowerCase())
              )
              .map((account) => {
                const snapshot = snapshotMap.get(account.id)
                return (
                  <TableRow key={account.id}>
                    <TableCell>{siteMap.get(account.siteId)?.name}</TableCell>
                    <TableCell>{account.username ?? account.id}</TableCell>
                    <TableCell>
                      {snapshot?.attemptedAt
                        ? new Date(snapshot.attemptedAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className='max-w-96 whitespace-normal'>
                      {snapshot?.error ||
                        (snapshot
                          ? `${snapshot.groups.length} ${t('accountGroups.name')}`
                          : t('accountGroups.notFetched'))}
                      {snapshot?.error && snapshot.fetchedAt && (
                        <p className='text-muted-foreground'>
                          {t('accountGroups.lastSuccess')}:{' '}
                          {new Date(snapshot.fetchedAt).toLocaleString()}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={refresh.busy}
                        onClick={() => refresh.mutate([account.id])}
                      >
                        {t('accountGroups.refresh')}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
