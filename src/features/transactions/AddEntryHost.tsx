// Global "+ Add Entry" modal host. Mounted once by the app shell; opens when useApp().addEntry is set
// (useApp().openAddEntry(prefill?)). Saving refreshes all data through bump().
import { useApp } from '@/app/AppContext'
import { EntryModal } from './EntryModal'

export function AddEntryHost() {
  const { addEntry, closeAddEntry, bump } = useApp()
  if (!addEntry) return null
  return <EntryModal key={addEntry.key} mode="create" prefill={addEntry.prefill} onClose={closeAddEntry} onSaved={bump} />
}
