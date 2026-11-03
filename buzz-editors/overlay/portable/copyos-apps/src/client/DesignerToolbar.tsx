/** Paired tool buttons and compact menus keep the canvas toolbar stable. */
import { useEffect, useState, type ReactNode } from 'react'
import { Menu, Tooltip, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { DesignerIcon as Icon } from './DesignerIcon.tsx'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import css from './PageDesignerWorkspace.module.css'
/** Available direct-manipulation tools. */
export type DesignerTool = 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'line'
/** Render the canvas tool tray with shared keyboard and mouse operations.
 * @param props - Active tool, localized labels and editor commands.
 * @returns The floating toolbar.
 */
export function DesignerToolbar({
  tool,
  setTool,
  t,
  image,
  assets,
  undo,
  redo,
  canUndo,
  canRedo,
  more,
  onMore,
  booleanMenu,
  onBoolean,
}: {
  tool: DesignerTool
  setTool: (tool: DesignerTool) => void
  t: (key: CopyOSFoundationLocaleKey) => string
  image: () => void
  assets: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  booleanMenu?: readonly MenuEntry[]
  onBoolean?: (id: string) => void
  more: readonly MenuEntry[]
  onMore: (id: string) => void
}): ReactNode {
  const [open, setOpen] = useState<string | null>(null)
  const [shape, setShape] = useState<DesignerTool>(
    tool === 'ellipse' || tool === 'line' ? tool : 'rectangle',
  )
  useEffect(() => {
    if (tool === 'rectangle' || tool === 'ellipse' || tool === 'line') setShape(tool)
    setOpen(null)
  }, [tool])
  const shapeTool = tool === 'rectangle' || tool === 'ellipse' || tool === 'line' ? tool : shape
  const menu = (id: string, label: string, entries: readonly MenuEntry[]): ReactNode => (
    <Menu
      portal
      side="top"
      compact
      autoFocus
      selectedId={id === 'shape' ? shapeTool : tool}
      open={open === id}
      onClose={() => {
        setOpen(null)
      }}
      anchor={
        <button
          type="button"
          className={id === 'more' || id === 'boolean' ? undefined : css.toolCaret}
          aria-label={id === 'more' || id === 'boolean' ? label : t('designerToolOptions').replace('{tool}', label)}
          aria-expanded={open === id}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            event.stopPropagation()
            setOpen(id)
          }}
          onClick={() => {
            setOpen(open === id ? null : id)
          }}
        >
          <Icon name={id === 'more' ? 'more' : id === 'boolean' ? 'group' : 'down'} />
        </button>
      }
      items={id === 'more' || id === 'boolean' ? entries : entries.map(entry => ({ ...entry, icon: <Icon name={entry.id} /> }))}
      onSelect={(selected) => {
        if (id === 'more') onMore(selected)
        else if (id === 'boolean') onBoolean?.(selected)
        else if (selected === 'image') image()
        else setTool(selected as DesignerTool)
        setOpen(null)
      }}
    />
  )
  const button = (value: DesignerTool, label: CopyOSFoundationLocaleKey, icon: string): ReactNode => {
    const accessible = ['frame', 'rectangle', 'ellipse', 'text'].includes(value)
      ? `${t(label)} (${value === 'ellipse' ? 'O' : value[0]?.toUpperCase()})`
      : t(label)
    return (
      <Tooltip label={accessible} side="top" portal delayMs={350} disabled={open !== null}>
        <button
          type="button"
          aria-label={accessible}
          aria-pressed={tool === value}
          onClick={() => {
            setTool(value)
          }}
        >
          <Icon name={icon} />
        </button>
      </Tooltip>
    )
  }

  return (
    <div
      className={css.toolbar}
      role="toolbar"
      aria-label={t('designerTools')}
      onKeyDown={(event) => {
        // Portaled menus own their arrow keys independently of the toolbar.
        if (!(event.target instanceof HTMLElement) || !event.currentTarget.contains(event.target)) return
        if (event.key === ' ' || event.key === 'Enter') {
          event.stopPropagation()
          return
        }
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 :
          event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!direction && event.key !== 'Home' && event.key !== 'End') return
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const focused = event.target.closest('button')
        if (!focused) return
        const index = controls.indexOf(focused)
        if (index < 0 || !controls.length) return
        event.preventDefault()
        event.stopPropagation()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 :
          (index + direction + controls.length) % controls.length
        controls[next]?.focus()
      }}
    >
      <div className={css.toolPair}>
        {button(
          tool === 'hand' ? 'hand' : 'select',
          tool === 'hand' ? 'designerHand' : 'designerSelect',
          tool === 'hand' ? 'hand' : 'select',
        )}
        {menu('move', t('designerSelect'), [
          { id: 'select', label: t('designerSelect') },
          { id: 'hand', label: t('designerHand') },
        ])}
      </div>
      <div className={css.toolPair}>
        {button('frame', 'designerFrame', 'frame')}
        {menu('frame', t('designerFrame'), [{ id: 'frame', label: t('designerFrame') }])}
      </div>
      <div className={css.toolPair}>
        {button(
          shapeTool,
          shapeTool === 'line' ? 'designerLine' : shapeTool === 'ellipse' ? 'designerEllipse' : 'designerRectangle',
          shapeTool,
        )}
        {menu('shape', t('designerShapes'), [
          { id: 'rectangle', label: t('designerRectangle') },
          { id: 'ellipse', label: t('designerEllipse') },
          { id: 'line', label: t('designerLine') },
          { id: 'image', label: t('designerImage') },
        ])}
      </div>
      <div className={css.toolPair}>{button('text', 'designer.text', 'text')}</div>
      <button type="button" title={t('designerImage')} aria-label={t('designerImage')} onClick={image}>
        <Icon name="image" />
      </button>
      <button
        type="button"
        title={t('designerAssets')}
        aria-label={t('designerToolbarAssets')}
        onClick={assets}
      >
        <Icon name="styles" />
      </button>
      <span className={css.separator} />
      <button
        type="button"
        aria-label={t('designerUndo')}
        title={t('designerUndo')}
        onClick={undo}
        disabled={!canUndo}
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        aria-label={t('designerRedo')}
        title={t('designerRedo')}
        onClick={redo}
        disabled={!canRedo}
      >
        <Icon name="redo" />
      </button>
      {booleanMenu ? menu('boolean', t('designerBoolean'), booleanMenu) : null}
      {menu('more', t('designerMoreTools'), more)}
    </div>
  )
}
