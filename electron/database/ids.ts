import { randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()
export const nowISO = (): string => new Date().toISOString()
