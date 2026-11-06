import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { request, buildQueryString } from '@/lib/api/transport'

export const testTypes = ['text', 'image', 'video', 'codex', 'search'] as const
export const planSchema = z.object({
  systemPrompt: z.string(),
  videoSystemPrompt: z.string(),
  codexSystemPrompt: z.string(),
  newsSource: z.enum(['', 'rss', 'spaceflight']),
  targets: z
    .array(
      z.object({
        accountId: z.number().positive(),
        model: z.string().min(1),
        type: z.enum(testTypes),
      })
    )
    .max(200),
  textPrompts: z
    .array(
      z
        .string()
        .min(1)
        .refine((value) => value.trim().length > 0)
    )
    .min(1),
  imagePrompt: z.string().min(1),
  videoPrompt: z.string().min(1),
  codexPrompt: z.string().min(1),
  searchPrompt: z.string().min(1),
  imageMedia: z.string(),
  videoMedia: z.string(),
  timeoutSeconds: z.number().int().min(1).max(600),
  maxOutputTokens: z.number().int().min(1).max(32768),
  scheduleEnabled: z.boolean(),
  cron: z.string().min(1),
  timezone: z.string().min(1),
})
export type TestPlan = z.infer<typeof planSchema>
export const resultSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  accountId: z.number(),
  siteId: z.number(),
  siteName: z.string(),
  accountName: z.string(),
  model: z.string(),
  type: z.enum(testTypes),
  source: z.string(),
  status: z.enum(['passed', 'partial', 'failed']),
  createdAt: z.string(),
  latencyMs: z.number(),
  text: z.string(),
  error: z.string(),
  detail: z.string(),
})
export const testKeys = {
  plan: ['model-tests', 'plan'] as const,
  history: ['model-tests', 'history'] as const,
}
export function useTestPlan() {
  return useQuery({
    queryKey: testKeys.plan,
    queryFn: async () =>
      planSchema.parse(await request('/api/model-tests/plan')),
  })
}
export function useSaveTestPlan() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (plan: TestPlan) =>
      request('/api/model-tests/plan', {
        method: 'PUT',
        body: JSON.stringify(plan),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: testKeys.plan }),
  })
}
export function useTestHistory(
  filters: Record<string, string | number>,
  running = false
) {
  return useQuery({
    queryKey: [...testKeys.history, filters],
    refetchInterval: running ? 2000 : false,
    queryFn: async () =>
      z
        .object({ items: z.array(resultSchema), total: z.number() })
        .parse(
          await request('/api/model-tests/history' + buildQueryString(filters))
        ),
  })
}
