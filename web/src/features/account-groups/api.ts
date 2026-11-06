import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { api } from '@/lib/api'
import { request } from '@/lib/api/transport'

const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  platform: z.string(),
  rate: z.number().nullable(),
  imagePrice1k: z.number().nullable(),
  imagePrice2k: z.number().nullable(),
  video: z.boolean(),
})
const snapshotsSchema = z.array(
  z.object({
    accountId: z.number(),
    groups: z.array(groupSchema),
    fetchedAt: z.string(),
    attemptedAt: z.string(),
    error: z.string(),
  })
)
const snapshotKey = ['account-group-snapshots'] as const

export function useAccountGroups() {
  return useQuery({
    queryKey: snapshotKey,
    queryFn: async () =>
      snapshotsSchema.parse(await request('/api/account-groups')),
  })
}

export function useRefreshAccountGroups() {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)
  const task = useQuery({
    queryKey: ['account-groups-task', taskId],
    enabled: taskId !== null,
    queryFn: async () => {
      if (taskId === null) throw new Error('Missing task ID')
      const result = (await api.getTask(taskId)) as {
        task: { status: string; error?: string }
      }
      if (['succeeded', 'failed'].includes(result.task.status)) {
        await queryClient.invalidateQueries({ queryKey: snapshotKey })
      }
      return result.task
    },
    refetchInterval: (query) =>
      query.state.data &&
      ['succeeded', 'failed'].includes(query.state.data.status)
        ? false
        : 1000,
  })
  const mutation = useMutation({
    mutationFn: (accountIds: number[]) =>
      request<{ taskId: string }>('/api/account-groups/refresh', {
        method: 'POST',
        body: JSON.stringify({ accountIds }),
      }),
    onSuccess: (result) => setTaskId(result.taskId),
  })
  return {
    ...mutation,
    task,
    busy:
      mutation.isPending ||
      (taskId !== null &&
        !['succeeded', 'failed'].includes(task.data?.status ?? '')),
  }
}
