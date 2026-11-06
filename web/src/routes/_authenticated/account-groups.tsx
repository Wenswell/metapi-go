import { createFileRoute } from '@tanstack/react-router'

import { AccountGroupsPage } from '@/features/account-groups/account-groups-page'
import { accountGroupsSearchSchema } from '@/features/account-groups/search'
export const Route = createFileRoute('/_authenticated/account-groups')({
  validateSearch: accountGroupsSearchSchema,
  staticData: { title: 'accountGroups.title' },
  component: AccountGroupsPage,
})
