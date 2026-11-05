import { useState } from 'react'
import { ArchiveRestore, FolderArchive, Save, X } from 'lucide-react'
import type { BackupInspectResult } from '@shared/api/backup'
import { Card } from '@/components/layout'
import { Button, IconButton } from '@/components/Button'
import { Alert, EmptyState, ErrorState, Loading } from '@/components/feedback'
import { Checkbox } from '@/components/form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toasts'
import { useApp } from '@/app/AppContext'
import { useQuery } from '@/hooks/useQuery'
import { api, errorMessage } from '@/services/api'
import { formatBytes, plural } from '@/utils/misc'

function RestoreDialog({ inspect, onClose, onRestored }: { inspect: BackupInspectResult; onClose: () => void; onRestored: () => void }) {
  const { fmt } = useApp()
  const toast = useToast()
  const [safety, setSafety] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const s = inspect.summary

  const restore = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.backup.restore({ token: inspect.token, safetyBackup: safety })
      toast.success(res.safetyBackupName ? `Backup restored. Your previous data was saved as ${res.safetyBackupName}.` : 'Backup restored.')
      onRestored()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Restore this backup?"
      subtitle={inspect.fileName}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={ArchiveRestore} loading={busy} onClick={() => void restore()}>
            {busy ? 'Restoring…' : 'Restore backup'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert kind="warning">
          <strong>This will replace the current Ledgerly data.</strong>
          <br />
          Continue?
        </Alert>
        <dl className="backup-facts" aria-label="Backup contents">
          <div>
            <dt>Created</dt>
            <dd>{fmt.dateTime(s.createdAt)}</dd>
          </div>
          <div>
            <dt>Ledgerly version</dt>
            <dd>{s.appVersion}</dd>
          </div>
          <div>
            <dt>Transactions</dt>
            <dd>{s.counts.transactions.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>{s.documentFiles.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Rules</dt>
            <dd>{s.counts.rules.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd>{s.counts.tags.toLocaleString()}</dd>
          </div>
          <div>
            <dt>File size</dt>
            <dd>{formatBytes(s.size)}</dd>
          </div>
        </dl>
        <Checkbox
          checked={safety}
          onChange={setSafety}
          disabled={busy}
          label="Create an automatic backup of my current data before restoring (recommended)"
        />
        <div className="small muted">
          The backup was checked before this step. If anything goes wrong during the restore, your current data is put back exactly as it was.
        </div>
        {error && <Alert kind="danger">{error}</Alert>}
      </div>
    </Modal>
  )
}

export function BackupSection() {
  const { fmt, bump, refreshBoot } = useApp()
  const toast = useToast()
  const list = useQuery(() => api.backup.list(), [])
  const [creating, setCreating] = useState<'ask' | 'backups-folder' | null>(null)
  const [inspecting, setInspecting] = useState<string | null>(null)
  const [inspect, setInspect] = useState<BackupInspectResult | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const create = async (destination: 'ask' | 'backups-folder') => {
    setCreating(destination)
    try {
      const res = await api.backup.create({ destination })
      if (res.saved) {
        toast.success(`Backup created: ${res.name} (${formatBytes(res.size)}).`)
        list.reload()
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setCreating(null)
    }
  }

  const startRestore = async (name?: string) => {
    setInspecting(name ?? '*')
    setRestoreError(null)
    try {
      const res = await api.backup.inspect(name ? { name } : undefined)
      if (res) setInspect(res)
    } catch (e) {
      setRestoreError(errorMessage(e))
    } finally {
      setInspecting(null)
    }
  }

  return (
    <>
      <Card title="Create a backup">
        <div className="stack">
          <p>
            A backup is a single <span className="mono">.ledgerlybackup</span> file holding your transactions, accounts, categories, tags, rules, budgets, goals, settings and your
            whole document vault. Ledgerly is fully offline, so a backup is the way to protect your data against a lost or damaged computer.
          </p>
          <div className="row wrap">
            <Button variant="primary" icon={Save} loading={creating === 'ask'} disabled={!!creating} onClick={() => void create('ask')}>
              Create backup…
            </Button>
            <Button icon={FolderArchive} loading={creating === 'backups-folder'} disabled={!!creating} onClick={() => void create('backups-folder')}>
              Save to the Ledgerly backups folder
            </Button>
          </div>
          <div className="small muted">
            Backup files are not encrypted. Keep them somewhere private, such as an external drive you control.
          </div>
        </div>
      </Card>

      <Card title="Restore from a backup">
        <div className="stack">
          <p>
            Restoring replaces everything currently in Ledgerly with the contents of a backup. The file is fully checked first, and Ledgerly can make an automatic backup of your
            current data before it starts.
          </p>
          {restoreError && (
            <Alert kind="danger" action={<IconButton icon={X} label="Dismiss" size="sm" onClick={() => setRestoreError(null)} />}>
              {restoreError}
            </Alert>
          )}
          <div>
            <Button icon={ArchiveRestore} loading={inspecting === '*'} disabled={!!inspecting} onClick={() => void startRestore()}>
              Restore backup…
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Backups in the Ledgerly folder">
        {list.error && !list.data ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState icon={FolderArchive} title="No backups yet" compact>
            Backups saved to the Ledgerly backups folder — including automatic safety backups — are listed here.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Backup</th>
                  <th scope="col">Created</th>
                  <th scope="col" className="num">
                    Size
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((b) => (
                  <tr key={b.name}>
                    <td className="mono" style={{ wordBreak: 'break-all' }}>
                      {b.name}
                    </td>
                    <td className="nowrap">{fmt.dateTime(b.createdAt)}</td>
                    <td className="num">{formatBytes(b.size)}</td>
                    <td className="actions">
                      <Button size="sm" icon={ArchiveRestore} loading={inspecting === b.name} disabled={!!inspecting} onClick={() => void startRestore(b.name)}>
                        Restore…
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="small muted" style={{ marginTop: 10 }}>
          {plural((list.data ?? []).length, 'backup')} · Use “Open data folder” in Data &amp; privacy to see them in Windows Explorer.
        </div>
      </Card>

      {inspect && (
        <RestoreDialog
          inspect={inspect}
          onClose={() => {
            setInspect(null)
            list.reload()
          }}
          onRestored={() => {
            void refreshBoot()
            bump()
          }}
        />
      )}
    </>
  )
}
