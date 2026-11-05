// Category Finder — IPC handlers. `search` is read-only; `apply` is the only call that writes.
import { z } from 'zod'
import { handle } from './register'
import { idSchema, shortText } from './schemas'
import {
  applySelection, cancelSession, getPage, saveRulesFromFinder, selectOp, startSearch, toggleRows, MAX_KEYWORDS
} from '../services/categoryFinder'

const sessionId = idSchema

export function registerCategoryFinderIpc(): void {
  handle(
    'categoryFinder.search',
    z.object({
      category: shortText(130, 'Category'),
      keywords: z.string().max(10_000, 'The keyword list is too long.'),
      wholeWord: z.boolean().optional()
    }),
    (input) => startSearch(input)
  )

  handle(
    'categoryFinder.page',
    z.object({ sessionId, page: z.number().int().min(1), pageSize: z.number().int().min(10).max(250) }),
    ({ sessionId: id, page, pageSize }) => getPage(id, page, pageSize)
  )

  handle(
    'categoryFinder.select',
    z.object({ sessionId, op: z.enum(['all', 'none', 'invert', 'default']) }),
    ({ sessionId: id, op }) => selectOp(id, op)
  )

  handle(
    'categoryFinder.toggle',
    z.object({ sessionId, ids: z.array(idSchema).min(1).max(250), selected: z.boolean() }),
    ({ sessionId: id, ids, selected }) => toggleRows(id, ids, selected)
  )

  handle('categoryFinder.apply', z.object({ sessionId }), ({ sessionId: id }) => applySelection(id))

  handle(
    'categoryFinder.saveRules',
    z.object({
      category: shortText(130, 'Category'),
      keywords: z.array(shortText(200, 'Keyword')).min(1, 'There are no keywords to save.').max(MAX_KEYWORDS),
      wholeWord: z.boolean().optional()
    }),
    ({ category, keywords, wholeWord }) => saveRulesFromFinder(category, keywords, !!wholeWord)
  )

  handle('categoryFinder.cancel', z.object({ sessionId }), ({ sessionId: id }) => cancelSession(id))
}
