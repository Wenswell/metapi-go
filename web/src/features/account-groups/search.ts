import { z } from 'zod'
export const accountGroupsSearchSchema = z.object({
  q: z.string().catch('').default(''),
  siteTag: z.string().catch('').default(''),
  platform: z.string().catch('').default(''),
  capability: z.enum(['all', 'image', 'video']).catch('all').default('all'),
  sort: z
    .enum(['name', 'rate', 'rate-desc', 'site'])
    .catch('name')
    .default('name'),
})
