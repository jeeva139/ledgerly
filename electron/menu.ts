import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/api'

/** Native Windows menu. Accelerators send a `menu:action` event to the renderer. */
export function buildMenu(getWindow: () => BrowserWindow | null, opts: { isDev: boolean; openDataFolder: () => void }): Menu {
  const send = (action: MenuAction) => () => getWindow()?.webContents.send('menu:action', action)
  const nav = (label: string, page: string, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: send(`navigate:${page}` as MenuAction)
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        { label: 'New transaction', accelerator: 'CmdOrCtrl+N', click: send('new-transaction') },
        { label: 'Import statement…', accelerator: 'CmdOrCtrl+I', click: send('import') },
        { label: 'Create backup…', accelerator: 'CmdOrCtrl+B', click: send('backup') },
        { type: 'separator' },
        { label: 'Lock Ledgerly', accelerator: 'CmdOrCtrl+L', click: send('lock') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Search transactions', accelerator: 'CmdOrCtrl+F', click: send('search') }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Refresh data', accelerator: 'CmdOrCtrl+R', click: send('refresh') },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(opts.isDev ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
      ]
    },
    {
      label: '&Go',
      submenu: [
        nav('Dashboard', 'dashboard', 'CmdOrCtrl+1'),
        nav('Transactions', 'transactions', 'CmdOrCtrl+2'),
        nav('Category Finder', 'category-finder', 'CmdOrCtrl+3'),
        nav('Import', 'import', 'CmdOrCtrl+4'),
        nav('Recurring', 'recurring', 'CmdOrCtrl+5'),
        nav('Subscriptions', 'subscriptions', 'CmdOrCtrl+6'),
        nav('Budgets', 'budgets', 'CmdOrCtrl+7'),
        nav('Goals', 'goals', 'CmdOrCtrl+8'),
        nav('Reports', 'reports', 'CmdOrCtrl+9'),
        nav('Documents', 'documents'),
        nav('Rules', 'rules'),
        nav('Settings', 'settings', 'CmdOrCtrl+,')
      ]
    },
    { label: '&Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    {
      label: '&Help',
      submenu: [
        { label: 'Open data folder', click: opts.openDataFolder },
        { type: 'separator' },
        { label: 'About Ledgerly', click: send('about') }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}
