/** Profile-wide MCP connection editor backed by revision-fenced settings mutations. */
import { useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CopyOSPanel.module.css'

export interface ConnectionEntry {
  readonly enabled: boolean
  readonly transport: 'http' | 'oauth' | 'stdio'
}
export interface ConnectionsValue { readonly connections: Readonly<Record<string, ConnectionEntry>> }
export type NewConnection =
  | { enabled: boolean; transport: 'http' | 'oauth'; url: string; headers: Record<string, string> }
  | { enabled: boolean; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
export interface ConnectionsInjected {
  readonly hooks: { readonly connections: Pick<ConfigForm<ConnectionsValue>, 'getSnapshot' | 'subscribe'> }
  readonly saveConnection: (name: string, value: NewConnection) => Promise<boolean>
  readonly enableConnection: (name: string, enabled: boolean) => Promise<boolean>
  readonly removeConnection: (name: string) => Promise<boolean>
}

function stringMap(text: string): Record<string, string> {
  const value: unknown = JSON.parse(text.trim() === '' ? '{}' : text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected a JSON object containing string values.')
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new Error('Expected a JSON object containing string values.')
    Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true, writable: true })
  }
  return result
}

/** Render saved connections and a draft that survives a refused save. */
export function ConnectionsSettings({ useConnections, saveConnection, enableConnection, removeConnection, t }:
  PropsRuntime<'settings.section'> & PropsLocale<'copyosFoundation'> & InjectFace<ConnectionsInjected>): ReactNode {
  const snapshot = useConnections(value => value)
  const entries = snapshot.value?.connections ?? {}
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'http' | 'oauth' | 'stdio'>('http')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [secrets, setSecrets] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const validName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u.test(name)
  const duplicate = Object.hasOwn(entries, name)

  const run = async (operation: () => Promise<boolean>): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      if (!await operation()) throw new Error(t('connectionsSaveRefused'))
      setNotice(t('connectionsSaved'))
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const save = async (): Promise<boolean> => {
    let fields: Record<string, string>
    let argumentsList: string[] = []
    try {
      fields = stringMap(secrets)
      if (transport === 'stdio') {
        const parsed: unknown = JSON.parse(args.trim() === '' ? '[]' : args)
        if (!Array.isArray(parsed) || !parsed.every((item: unknown) => typeof item === 'string')) throw new Error()
        argumentsList = parsed
      }
    } catch (failure: unknown) {
      throw new Error(t(transport === 'stdio' ? 'connectionsInvalidLocalJson' : 'connectionsInvalidHeaders'), { cause: failure })
    }
    if (transport !== 'stdio') {
      let endpoint: URL
      try { endpoint = new URL(url) } catch (failure: unknown) { throw new Error(t('connectionsInvalidUrl'), { cause: failure }) }
      if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error(t('connectionsInvalidUrl'))
    }
    const saved = await saveConnection(name, transport === 'stdio'
      ? { enabled: true, transport, command, args: argumentsList, env: fields }
      : { enabled: true, transport, url, headers: fields })
    if (saved) { setName(''); setUrl(''); setCommand(''); setArgs(''); setSecrets('') }
    return saved
  }
  return <section className={css.connectionsSettings}>
    <h2>{t('connectionsTitle')}</h2><p>{t('connectionsDescription')}</p>
    {!writable ? <p role="status">{t('connectionsUnavailable')}</p> : null}
    {Object.entries(entries).length === 0 ? <p>{t('connectionsEmpty')}</p> : <ul className={css.connectionsList}>
      {Object.entries(entries).map(([id, entry]) => <li key={id}>
        <div><strong>{id}</strong><small>{t(entry.enabled ? 'connectionsEnabled' : 'connectionsDisabled')}</small></div>
        <Button variant="outline" disabled={busy || !writable} onClick={() => { void run(() => enableConnection(id, !entry.enabled)) }}>
          {t(entry.enabled ? 'connectionsDisable' : 'connectionsEnable')}</Button>
        <Button variant="outline" disabled={busy || !writable} onClick={() => { void run(() => removeConnection(id)) }}>{t('connectionsRemove')}</Button>
      </li>)}
    </ul>}
    <div className={css.newSessionStructuredForm}>
      <h3>{t('connectionsAdd')}</h3>
      <div className={css.newSessionChoiceRow}>
        <Button variant="outline" disabled={busy || !writable} onClick={() => { setName('composio'); setTransport('oauth'); setUrl('https://connect.composio.dev/mcp'); setSecrets('') }}>{t('connectionsComposio')}</Button>
        <Button variant="outline" disabled={busy || !writable} onClick={() => { setName('notion'); setTransport('oauth'); setUrl('https://mcp.notion.com/mcp'); setSecrets('') }}>{t('connectionsNotion')}</Button>
        <Button variant="outline" disabled={busy || !writable} onClick={() => { setName('figma'); setTransport('oauth'); setUrl('https://mcp.figma.com/mcp'); setSecrets('') }}>{t('connectionsFigma')}</Button>
      </div>
      {url.trim() === 'https://mcp.figma.com/mcp' ? <p>{t('connectionsFigmaHint')}</p> : null}
      <fieldset disabled={busy || !writable} className={css.connectionsFields}>
        <label><span>{t('connectionsName')}</span><input value={name} onChange={(event) => { setName(event.currentTarget.value) }} /></label>
        <p>{t('connectionsNameHint')}</p>
        <label><span>{t('connectionsTransport')}</span><select value={transport} onChange={(event) => { setTransport(event.currentTarget.value as typeof transport); setSecrets('') }}>
          <option value="http">{t('connectionsHttp')}</option><option value="oauth">{t('connectionsOAuth')}</option><option value="stdio">{t('connectionsStdio')}</option>
        </select></label>
        {transport === 'stdio' ? <>
          <label><span>{t('connectionsCommand')}</span><input value={command} onChange={(event) => { setCommand(event.currentTarget.value) }} /></label>
          <label><span>{t('connectionsArgs')}</span><textarea rows={2} value={args} onChange={(event) => { setArgs(event.currentTarget.value) }} /></label>
        </> : <label><span>{t('connectionsUrl')}</span><input type="url" value={url} autoComplete="off" onChange={(event) => { setUrl(event.currentTarget.value) }} /></label>}
        {transport === 'oauth' ? <p>{t('connectionsOAuthHint')}</p> : <label>
          <span>{t(transport === 'stdio' ? 'connectionsEnv' : 'connectionsHeaders')}</span>
          <textarea rows={3} value={secrets} autoComplete="off" spellCheck={false} onChange={(event) => { setSecrets(event.currentTarget.value) }} />
        </label>}
      </fieldset>
      {duplicate ? <p role="alert">{t('connectionsDuplicate')}</p> : null}
      <Button variant="primary" disabled={busy || !writable || !validName || duplicate || (transport === 'stdio' ? command.trim() === '' : url.trim() === '')}
        onClick={() => { void run(save) }}>{t(busy ? 'connectionsSaving' : 'connectionsSave')}</Button>
      {error !== '' ? <p role="alert">{error}</p> : null}
      {notice !== '' ? <p role="status">{notice}</p> : null}
    </div>
  </section>
}
