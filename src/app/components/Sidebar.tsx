import { useState } from 'react'
import { Tabs, type TabItem } from '@/ui'
import { t } from '../i18n'
import { AccentsPanel } from './accents/AccentsPanel'
import { ExportPanel } from './ExportPanel'
import { OutputPanel } from './OutputPanel'
import { StylePanel } from './StylePanel'
import { TrackPanel } from './TrackPanel'

type SidebarTab = 'output' | 'style' | 'accents'

const ITEMS: TabItem<SidebarTab>[] = [
  { value: 'style', label: t.sidebar.style, content: <StylePanel /> },
  { value: 'accents', label: t.sidebar.accents, content: <AccentsPanel /> },
  { value: 'output', label: t.sidebar.output, content: <OutputPanel /> },
]

export function Sidebar() {
  const [tab, setTab] = useState<SidebarTab>('style')
  return (
    <aside
      aria-label={t.sidebar.label}
      className="flex w-full shrink-0 flex-col border-line bg-surface lg:w-80 lg:border-l"
    >
      <TrackPanel />
      <Tabs
        label={t.sidebar.label}
        value={tab}
        items={ITEMS}
        onChange={setTab}
        className="flex-1"
      />
      <ExportPanel />
    </aside>
  )
}
