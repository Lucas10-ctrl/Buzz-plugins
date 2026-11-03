/** Shared directory interaction for CopyOS workspace and page-folder actions. */
import { useSyncExternalStore } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/** One pending directory choice, settled by the composed picker or plugin disposal. */
export interface DirectoryChoice {
  /** Start a directory choice; concurrent callers share the pending interaction. */
  pick: () => Promise<string | null>
  /** Observe whether the interaction is open. */
  getSnapshot: () => boolean
  /** Subscribe to interaction visibility. */
  subscribe: (listener: () => void) => () => void
  /** Complete the interaction with a selected path. */
  picked: (path: string) => void
  /** Complete the interaction as cancelled. */
  cancel: () => void
  /** Reject the interaction with the picker failure. */
  fail: (message: string) => void
}

/** @returns a directory choice shared by all CopyOS folder actions. */
export function createDirectoryChoice(): DirectoryChoice {
  const listeners = new Set<() => void>()
  let pending: { promise: Promise<string | null>; resolve: (path: string | null) => void; reject: (error: Error) => void } | undefined
  const notify = (): void => { for (const listener of listeners) listener() }
  const finish = (path: string | null, error?: Error): void => {
    const operation = pending
    pending = undefined
    if (operation === undefined) return
    if (error === undefined) operation.resolve(path)
    else operation.reject(error)
    notify()
  }
  return {
    pick: () => {
      if (pending !== undefined) return pending.promise
      let resolve!: (path: string | null) => void
      let reject!: (error: Error) => void
      const promise = new Promise<string | null>((accept, refuse) => { resolve = accept; reject = refuse })
      pending = { promise, resolve, reject }
      notify()
      return promise
    },
    getSnapshot: () => pending !== undefined,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    picked: path => finish(path),
    cancel: () => finish(null),
    fail: message => finish(null, new Error(message)),
  }
}

/**
 * Render the configured native or browse interaction in the application overlay.
 * @param props - directory choice and child-slot renderer.
 * @returns the composed directory flow.
 */
export function DirectoryChoiceOverlay({ choice, renderSlot }: {
  choice: DirectoryChoice
} & PropsRenderSlots<'workspace.directoryFlow'>) {
  const open = useSyncExternalStore(choice.subscribe, choice.getSnapshot, choice.getSnapshot)
  return renderSlot('workspace.directoryFlow', {
    open, busy: false, onPicked: choice.picked, onCancel: choice.cancel, onError: choice.fail,
  })
}
