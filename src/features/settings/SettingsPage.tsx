import { useEffect, useState, type ComponentType } from 'react'
import {
  Archive, CalendarSync, FolderLock, Import, Landmark, ListTree, Scale, Settings2, ShieldAlert, ShieldCheck, Tags, type LucideIcon
} from 'lucide-react'
import { useApp } from '@/app/AppContext'
import { PageHeader } from '@/components/layout'
import { GeneralSection } from './GeneralSection'
import { AccountsSection } from './AccountsSection'
import { CategoriesSection } from './CategoriesSection'
import { TagsSection } from './TagsSection'
import { NetWorthSection } from './NetWorthSection'
import { DetectionSection } from './DetectionSection'
import { ImportSection } from './ImportSection'
import { BackupSection } from './BackupSection'
import { SecuritySection } from './SecuritySection'
import { DataSection } from './DataSection'
import { DangerSection } from './DangerSection'
import './settings.css'

export type SectionId =
  | 'general'
  | 'accounts'
  | 'categories'
  | 'tags'
  | 'net-worth'
  | 'detection'
  | 'import'
  | 'backup'
  | 'security'
  | 'data'
  | 'danger'

interface SectionDef {
  id: SectionId
  label: string
  icon: LucideIcon
  component: ComponentType
  danger?: boolean
  groupStart?: boolean
}

const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', icon: Settings2, component: GeneralSection },
  { id: 'accounts', label: 'Accounts', icon: Landmark, component: AccountsSection },
  { id: 'categories', label: 'Categories', icon: ListTree, component: CategoriesSection },
  { id: 'tags', label: 'Tags', icon: Tags, component: TagsSection },
  { id: 'net-worth', label: 'Net worth', icon: Scale, component: NetWorthSection },
  { id: 'detection', label: 'Detection', icon: CalendarSync, component: DetectionSection },
  { id: 'import', label: 'Import', icon: Import, component: ImportSection },
  { id: 'backup', label: 'Backup & restore', icon: Archive, component: BackupSection, groupStart: true },
  { id: 'security', label: 'Security', icon: ShieldCheck, component: SecuritySection },
  { id: 'data', label: 'Data & privacy', icon: FolderLock, component: DataSection },
  { id: 'danger', label: 'Danger zone', icon: ShieldAlert, component: DangerSection, danger: true, groupStart: true }
]

const isSection = (v: unknown): v is SectionId => typeof v === 'string' && SECTIONS.some((s) => s.id === v)

export function SettingsPage() {
  const { route } = useApp()
  const requested = route.params.section
  const [section, setSection] = useState<SectionId>(isSection(requested) ? requested : 'general')

  // Navigating here again with another section (e.g. Ctrl+B → backup) switches to it.
  useEffect(() => {
    if (isSection(requested)) setSection(requested)
  }, [requested, route])

  const current = SECTIONS.find((s) => s.id === section)!
  const Section = current.component

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Preferences, your accounts and categories, backups and privacy. Everything is stored on this computer." />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.id} style={{ display: 'contents' }}>
                {s.groupStart && <div className="nav-sep" role="separator" style={{ height: 1, margin: '6px 8px' }} />}
                <button
                  className={s.danger ? 'danger' : ''}
                  aria-current={section === s.id ? 'true' : undefined}
                  onClick={() => setSection(s.id)}
                >
                  <Icon size={17} aria-hidden />
                  {s.label}
                </button>
              </div>
            )
          })}
        </nav>
        <div className="settings-body">
          <Section />
        </div>
      </div>
    </div>
  )
}

