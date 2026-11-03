/** Project-scoped trusted font metadata, fetched only when an axis editor requests it. */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { CopyOSDesignFontMetadata, CopyOSDesignFontMetadataRequest } from '../../../copyos-domain/src/types.ts'

const FontMetadata = createContext<((family: string) => Promise<CopyOSDesignFontMetadata>) | undefined>(undefined)

/**
 * Share up to 256 recent font lookups within one workspace and metadata reader; failed reads can retry.
 * @param props - Workspace, optional trusted metadata reader, and descendant editors.
 * @returns Descendants with a lazy workspace-scoped reader, or no reader when unsupported.
 */
export function DesignerFontMetadataProvider({ workspaceId, readFontMetadata, children }: {
  workspaceId: string
  readFontMetadata?: ((request: CopyOSDesignFontMetadataRequest) => Promise<CopyOSDesignFontMetadata>) | undefined
  children: ReactNode
}) {
  const lookup = useMemo(() => {
    if (!readFontMetadata) return undefined
    const cache = new Map<string, Promise<CopyOSDesignFontMetadata>>()
    return (family: string): Promise<CopyOSDesignFontMetadata> => {
      const cached = cache.get(family)
      if (cached) return cached
      const pending = Promise.resolve().then(() => readFontMetadata({ workspaceId, family }))
      cache.set(family, pending)
      if (cache.size > 256) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      void pending.catch(() => {
        if (cache.get(family) === pending) cache.delete(family)
      })
      return pending
    }
  }, [workspaceId, readFontMetadata])
  return <FontMetadata.Provider value={lookup}>{children}</FontMetadata.Provider>
}

/**
 * Return the current workspace's optional metadata reader without scanning installed fonts or files.
 * @returns The lazy family lookup, or undefined outside a provider or without its reader.
 */
export function useDesignerFontMetadata(): ((family: string) => Promise<CopyOSDesignFontMetadata>) | undefined {
  return useContext(FontMetadata)
}
