import { createFileRoute } from '@tanstack/react-router'

import { ModelTestsPage } from '@/features/model-tests/model-tests-page'
import { modelTestsSearchSchema } from '@/features/model-tests/search'
export const Route = createFileRoute('/_authenticated/model-tests')({
  validateSearch: modelTestsSearchSchema,
  staticData: { title: 'modelTests.title' },
  component: ModelTestsPage,
})
