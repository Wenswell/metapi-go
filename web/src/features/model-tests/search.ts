import { z } from 'zod'

import { testTypes } from './api'
export const modelTestsSearchSchema = z.object({
  testTargetsQ: z.string().catch('').default(''),
  testTargetsSort: z.string().catch('').default(''),
  testTargetsPage: z.coerce.number().int().positive().catch(1).default(1),
  testTargetsSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .catch(20)
    .default(20),
  testHistoryQ: z.string().catch('').default(''),
  testHistorySort: z.string().catch('').default(''),
  testHistoryPage: z.coerce.number().int().positive().catch(1).default(1),
  testHistorySize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .catch(20)
    .default(20),
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
