import { z } from 'zod'
export const accountGroupsSearchSchema = z.object({
  groupRowsQ: z.string().catch('').default(''),
  groupRowsSort: z.string().catch('').default(''),
  groupRowsPage: z.coerce.number().int().positive().catch(1).default(1),
  groupRowsSize: z.coerce.number().int().min(1).max(200).catch(20).default(20),
  groupStatusQ: z.string().catch('').default(''),
  groupStatusSort: z.string().catch('').default(''),
  groupStatusPage: z.coerce.number().int().positive().catch(1).default(1),
  groupStatusSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .catch(20)
    .default(20),
  q: z.string().catch('').default(''),
  siteTag: z.string().catch('').default(''),
  platform: z.string().catch('').default(''),
  capability: z.enum(['all', 'image', 'video']).catch('all').default('all'),
  sort: z
    .enum(['name', 'rate', 'rate-desc', 'site'])
    .catch('name')
    .default('name'),
})
