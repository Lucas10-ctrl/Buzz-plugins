/** Consistent 16px controls for the compact design workspace. */
import type { ReactNode } from 'react'
/**
 * Draw one interface glyph without relying on platform emoji or symbol fonts.
 * @param props - Glyph name.
 * @returns an accessible decorative SVG.
 */
export function DesignerIcon({ name }: { name: string }): ReactNode {
  const paths: Record<string, string> = {
    constraints: 'M4 8V4h4M14 4h4v4M4 14v4h4M14 18h4v-4M8 8h6v6H8zM4 11h4m6 0h4M11 4v4m0 6v4',
    opacity: 'M4 4h14v14H4zM4 8h14M4 12h14M4 16h14M8 4v14M12 4v14M16 4v14',
    'corner-tl': 'M5 17V9a4 4 0 0 1 4-4h8',
    'corner-tr': 'M5 5h8a4 4 0 0 1 4 4v8',
    'corner-bl': 'M5 5v8a4 4 0 0 0 4 4h8',
    'corner-br': 'M5 17h8a4 4 0 0 0 4-4V5',
    radius: 'M3 8V4h4M15 4h4v4M3 14v4h4M15 18h4v-4M8 14v-3a3 3 0 0 1 3-3h3',
    'padding-top': 'M4 4h14v14H4zM7 7h8M7 10h8',
    'padding-right': 'M4 4h14v14H4zM15 7v8M12 7v8',
    'padding-bottom': 'M4 4h14v14H4zM7 15h8M7 12h8',
    'padding-left': 'M4 4h14v14H4zM7 7v8M10 7v8',
    gap: 'M4 4h14M4 18h14M6 8h10M6 14h10M11 8v6m-2-4 2-2 2 2m-4 2 2 2 2-2',
    'line-height': 'M4 4v14M2 6l2-2 2 2M2 16l2 2 2-2M10 17l4-12 4 12M11 13h6',
    'letter-spacing': 'M3 17h16M5 15v4M17 15v4M7 12l4-9 4 9M8 9h6',
    minus: 'M4 11h14',
    chat: 'M4 5h14v10H10l-4 3v-3H4z',
    expand: 'M4 9V4h5M13 4h5v5M18 13v5h-5M9 18H4v-5',
    shrink: 'M8 4v4H4M14 4v4h4M14 18v-4h4M8 18v-4H4',
    down: 'M7 9l4 4 4-4',
    settings: 'M5 3v6m0 4v6M11 3v10m0 4v2M17 3v2m0 4v10M3 9h4M9 13h4M15 5h4',
    styles: 'M4 4h4v4H4zM14 4h4v4h-4zM4 14h4v4H4zM14 14h4v4h-4z',
    'align-x-start': 'M4 3v16M8 7h10M8 15h6',
    'align-x-center': 'M11 3v16M5 7h12M7 15h8',
    'align-x-end': 'M18 3v16M4 7h10M8 15h6',
    'align-y-start': 'M3 4h16M7 8v10M15 8v6',
    'align-y-center': 'M3 11h16M7 5v12M15 7v8',
    'align-y-end': 'M3 18h16M7 4v10M15 8v6',
    'text-left': 'M4 5h14M4 9h9M4 13h14M4 17h9',
    'text-center': 'M4 5h14M7 9h8M4 13h14M7 17h8',
    'text-right': 'M4 5h14M9 9h9M4 13h14M9 17h9',
    'vertical-top': 'M3 4h16M11 8v11M8 11l3-3 3 3',
    'vertical-center': 'M3 11h16M11 3v5m-3-3 3 3 3-3M11 19v-5m-3 3 3-3 3 3',
    'vertical-bottom': 'M3 18h16M11 3v11m-3-3 3 3 3-3',
    'layout-grid': 'M3 3h16v16H3zM3 11h16M11 3v16',
    'layout-none': 'M4 4h4v4H4zM14 4h4v4h-4zM4 14h4v4H4zM14 14h4v4h-4z',
    'layout-row': 'M3 4h5v9H3zM12 4h5v9h-5zM3 18h15m-3-3 3 3-3 3',
    'layout-column': 'M4 3h9v5H4zM4 12h9v5H4zM18 3v15m-3-3 3 3 3-3',
    distribute: 'M4 3v16M18 3v16M8 7v8M14 7v8M7 4h8m-6-2L7 4l2 2m4-4 2 2-2 2',
    pen: 'M4 17 8 4l11 7-11 8zM8 4l4 9m-7 5 6-5m2-1h.01',
    note: 'M6 3h10l3 3v13H5V3zM8 7h6M8 10h7M8 13h7M8 16h5',
    shapes: 'M4 10V7a5 5 0 0 1 10 0v3M3 10h15v9H3z',
    chevron: 'M8 6l5 5-5 5',
    select: 'M4 2.5 17 11l-6 1.5L8 19z',
    hand: 'M6 10V6a1 1 0 0 1 2 0v4-6a1 1 0 0 1 2 0v6-5a1 1 0 0 1 2 0v5-3a1 1 0 0 1 2 0v6c0 4-2 6-5 6s-4-2-5-4l-2-3a1 1 0 0 1 1-1l3 2',
    frame: 'M7 2 5 20M15 2l-2 18M2 7h18M2 15h18',
    rectangle: 'M4 4h14v14H4z',
    ellipse: 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    typography: 'M4 4h14M11 4v14M7 18h8',
    file: 'M6 2h7l4 4v14H6zM13 2v5h4',
    assets: 'M11 2 13.5 8.5 20 11l-6.5 2.5L11 20l-2.5-6.5L2 11l6.5-2.5z',
    image: 'M3 4h16v14H3zM3 15l5-5 5 5 3-3 3 3M14 7h.01',
    more: 'M4 11h.1M11 11h.1M18 11h.1',
    play: 'M7 3.5 18 11 7 18.5z',
    save: 'M5 3h11l3 3v13H3V3zM7 3v6h8V3M7 19v-7h8v7',
    back: 'M14 4 7 11l7 7',
    'back-arrow': 'M18 11H4m6-6-6 6 6 6',
    component: 'M11 3 19 11 11 19 3 11z',
    'component-set': 'M7 2 11 6 7 10 3 6zM15 2 19 6 15 10 11 6zM7 10 11 14 7 18 3 14zM15 10 19 14 15 18 11 14z',
    search: 'M14.5 14.5 20 20M16 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    plus: 'M11 4v14M4 11h14',
    close: 'M5 5 17 17M17 5 5 17',
    undo: 'M7 5 3 9l4 4M3 9h10a5 5 0 0 1 0 10',
    redo: 'M15 5 19 9l-4 4M19 9H9a5 5 0 0 0 0 10',
    lock: 'M6 9V6a5 5 0 0 1 10 0v3M4 9h14v11H4z',
    eye: 'M2 11s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6M14 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    hidden: 'M3 3 19 19M7 6C4 8 2 11 2 11s3 6 9 6c2 0 4-1 5-2M11 5c5 0 9 6 9 6s-1 2-3 4',
    'align-left': 'M4 3v16M7 6h11M7 11h7M7 16h11',
    'align-top': 'M3 4h16M6 7v11M11 7v7M16 7v11',
    path: 'M3 18 8 4 19 9 14 18zM8 4l4 9 7-4M12 13l2 5',
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 22 22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name === 'text' ? 'typography' : name] ?? paths.rectangle} />
    </svg>
  )
}
