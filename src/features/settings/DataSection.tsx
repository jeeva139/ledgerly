import { CloudOff, FolderOpen, HardDrive, ShieldCheck, WifiOff } from 'lucide-react'
import { Card } from '@/components/layout'
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { api, errorMessage } from '@/services/api'

export function DataSection() {
  const { boot } = useApp()
  const toast = useToast()

  const openFolder = async () => {
    try {
      await api.app.openDataFolder()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <>
      <Card title="Where your data lives">
        <div className="stack">
          <p>
            Everything Ledgerly knows is stored in one folder on this computer:
          </p>
          <div className="row wrap">
            <span className="mono" style={{ wordBreak: 'break-all' }} aria-label="Data folder">
              {boot.dataLocation || 'the Ledgerly data folder'}
            </span>
            <Button icon={FolderOpen} onClick={() => void openFolder()}>
              Open data folder
            </Button>
          </div>
          <div className="folder-tree" aria-label="Folder layout">
            ledgerly.db — your transactions, accounts, rules, tags and settings
            <br />
            documents/ — receipts, invoices, statements and other files
            <br />
            backups/ — backups you create (and automatic safety backups)
            <br />
            exports/ — files you export
            <br />
            logs/ — technical messages only; never your financial details
          </div>
          <div className="small muted">
            Please do not edit these files by hand while Ledgerly is open. Use Backup &amp; restore to copy your data safely.
          </div>
        </div>
      </Card>

      <Card title="Private. Offline. Local.">
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <HardDrive size={20} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
            <span>
              <strong>Your financial data stays on your computer.</strong> Ledgerly never uploads transactions, documents or files, and it does not need an account.
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <WifiOff size={20} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
            <span>
              <strong>It works without internet.</strong> Importing, categorising, reports, backups and restores all run on this computer. Ledgerly blocks network access.
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <CloudOff size={20} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
            <span>
              <strong>No cloud, no sync, no telemetry.</strong> There is no tracking and no analytics. Nobody receives information about how you use Ledgerly.
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <ShieldCheck size={20} aria-hidden style={{ flex: 'none', marginTop: 2 }} />
            <span>
              <strong>Honest about protection.</strong> Your files are protected by your Windows account. Ledgerly does not encrypt its database; the optional application lock only
              controls who can open the app.
            </span>
          </div>
          <div className="small muted">Ledgerly version {boot.appVersion}</div>
        </div>
      </Card>
    </>
  )
}
