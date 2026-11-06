import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function SiteTagFilter({
  tags,
  value,
  onChange,
}: {
  tags: string[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? '')}>
      <SelectTrigger aria-label={t('siteTags.filter')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value=''>{t('siteTags.all')}</SelectItem>
        {[...new Set(tags)].sort().map((tag) => (
          <SelectItem key={tag} value={tag}>
            {tag}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
