// In-memory application-lock state (main process). While locked, every IPC handler except the
// ones explicitly marked `allowWhenLocked` is refused, so a locked UI cannot read any data.
let locked = false

export const isLocked = (): boolean => locked
export const setLocked = (value: boolean): void => {
  locked = value
}
