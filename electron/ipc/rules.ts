// Rules — IPC handlers.
import { z } from 'zod'
import { handle, noArgs } from './register'
import { idSchema } from './schemas'
import {
  createRule, deleteRule, listRulesView, moveRule, recategorizeApply, recategorizePreview, setRuleEnabled, sortBySpecificity,
  updateRule, MAX_KEYWORD_LENGTH
} from '../services/rules'

const matchType = z.enum(['contains', 'word', 'starts_with', 'equals'])
const whenText = z.string().max(MAX_KEYWORD_LENGTH + 50, `The rule text can be at most ${MAX_KEYWORD_LENGTH} characters long.`)
const thenText = z.string().max(130)
const recatOptions = z.object({ includeCategorized: z.boolean(), includeLocked: z.boolean() })

export function registerRulesIpc(): void {
  handle('rules.list', noArgs, () => listRulesView())

  handle(
    'rules.create',
    z.object({ whenText, thenText, matchType: matchType.optional(), enabled: z.boolean().optional() }),
    (input) => createRule(input)
  )

  handle(
    'rules.update',
    z.object({ id: idSchema, whenText: whenText.optional(), thenText: thenText.optional(), matchType: matchType.optional(), enabled: z.boolean().optional() }),
    ({ id, ...patch }) => updateRule(id, patch)
  )

  handle('rules.delete', z.object({ id: idSchema }), ({ id }) => deleteRule(id))
  handle('rules.setEnabled', z.object({ id: idSchema, enabled: z.boolean() }), ({ id, enabled }) => setRuleEnabled(id, enabled))
  handle('rules.move', z.object({ id: idSchema, direction: z.enum(['up', 'down']) }), ({ id, direction }) => moveRule(id, direction))
  handle('rules.sortBySpecificity', noArgs, () => sortBySpecificity())
  handle('rules.recategorizePreview', recatOptions, (opts) => recategorizePreview(opts))
  handle('rules.recategorizeApply', recatOptions, (opts) => recategorizeApply(opts))
}
