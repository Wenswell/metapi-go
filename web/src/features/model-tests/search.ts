import { z } from 'zod'

import { testTypes } from './api'
export const modelTestsSearchSchema = z.object({
  q: z.string().catch('').default(''),
  siteTag: z.string().catch('').default(''),
  type: z
    .enum(['', ...testTypes])
    .catch('')
    .default(''),
  status: z.enum(['', 'passed', 'partial', 'failed']).catch('').default(''),
  from: z.string().catch('').default(''),
  to: z.string().catch('').default(''),
  batchId: z.string().catch('').default(''),
  page: z.coerce.number().int().positive().catch(1).default(1),
  targetQ: z.string().catch('').default(''),
  targetTag: z.string().catch('').default(''),
})
