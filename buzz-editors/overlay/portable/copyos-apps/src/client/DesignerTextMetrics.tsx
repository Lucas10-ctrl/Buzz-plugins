/** Capture actual font baselines without substituting a font-size heuristic. */
import { useLayoutEffect, useRef } from 'react'
import type { CopyOSDesignNode } from '../../../copyos-domain/src/types.ts'
import {
  designFontFeatureSettings,
  designFontVariationSettings,
  designTextBaselineSignature,
  designTextOverflow,
  designTextOverflowSignature,
  designTextHtmlContent,
} from '../../../copyos-domain/src/design-model.ts'
import { designerUnscaledTextWidth } from './DesignerTextWidth.ts'
import { measureDesignerTextOverflow } from './DesignerTextOverflow.ts'
import { runDesignerMeasure, watchDesignerFonts } from './DesignerMeasureBatch.ts'

/** Measure an unscaled text copy and repeat after browser fonts settle.
 * @param props - Resolved text and a callback that persists its exact measurement.
 * @returns No visible content; temporary measurement elements are removed synchronously.
 */
export function DesignerTextMetrics({
  node,
  onMeasure,
  captureBaseline = true,
  onSize,
}: {
  node: CopyOSDesignNode
  onMeasure: (
    metrics: NonNullable<CopyOSDesignNode['textBaselineMetrics']>[number],
  ) => void
  captureBaseline?: boolean | undefined
  onSize?:
    | ((size: {
      width: number
      height: number
      visibleHeight: number
      overflow?: NonNullable<
        CopyOSDesignNode['textLayoutMetrics']
      >['overflow']
    }) => void)
    | undefined
}): null {
  const signature = designTextBaselineSignature(node)
  const overflowSignature =
    node.textTruncation === 'ending' ? designTextOverflowSignature(node) : null
  const engineCaches = JSON.stringify([node.textLayoutMetrics?.engine ?? null,
    (node.textBaselineMetrics ?? []).filter(metrics => metrics.engine).map(metrics => [metrics.signature, metrics.engine])])
  const latest = useRef({ node, onMeasure, onSize })
  latest.current = { node, onMeasure, onSize }
  useLayoutEffect(() => {
    let active = true
    const measure = (): void => {
      if (!active) return
      const { node, onMeasure, onSize } = latest.current
      if (
        designTextBaselineSignature(node) !== signature ||
        (node.textTruncation === 'ending'
          ? designTextOverflowSignature(node)
          : null) !== overflowSignature
      )
        return
      const outer = document.createElement('div')
      outer.setAttribute('aria-hidden', 'true')
      Object.assign(outer.style, {
        position: 'fixed',
        left: '-1000000px',
        top: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        margin: '0',
        padding: '0',
        border: '0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        width:
          node.textSizing === 'auto-width' ? 'max-content' : `${node.width}px`,
        minHeight:
          node.verticalAlign &&
          node.verticalAlign !== 'top' &&
          (!node.textSizing || node.textSizing === 'fixed')
            ? `${node.height}px`
            : '0',
        justifyContent:
          node.verticalAlign === 'center'
            ? 'center'
            : node.verticalAlign === 'bottom'
              ? 'flex-end'
              : 'flex-start',
      })
      const content = document.createElement('div')
      Object.assign(content.style, {
        fontFamily: node.fontFamily,
        fontSize: `${node.fontSize}px`,
        fontWeight: String(node.fontWeight),
        fontFeatureSettings: designFontFeatureSettings(node.fontFeatures),
        fontVariationSettings: designFontVariationSettings(node.fontVariations),
        fontStyle: node.fontStyle ?? 'normal',
        lineHeight: String(node.lineHeight),
        letterSpacing: `${node.letterSpacing ?? 0}px`,
        textTransform: node.textCase ?? 'none',
        textAlign: node.textAlign,
        whiteSpace:
          node.textSizing === 'auto-width' || node.textWrap === false
            ? 'pre'
            : 'pre-wrap',
        overflowWrap: 'break-word',
        minHeight: '1em',
        flexShrink: '1',
        width:
          node.textSizing === 'auto-width' ? 'max-content' : `${node.width}px`,
      })
      content.innerHTML = designTextHtmlContent(node)
      const marker = document.createElement('span')
      Object.assign(marker.style, {
        display: 'inline-block',
        width: '0',
        height: '0',
        padding: '0',
        margin: '0',
        border: '0',
        verticalAlign: 'baseline',
        fontSize: '0',
        lineHeight: '0',
      })
      const first = content.firstElementChild ?? content
      let fullWidth = 0,
        fullHeight = 0,
        visibleHeight = 0,
        baseline = 0,
        exactOverflow: ReturnType<typeof measureDesignerTextOverflow> = null
      runDesignerMeasure({
        steps: [
          () => {
            outer.append(content)
            document.body.append(outer)
          },
          () => {
            // Read complete paragraph geometry before applying an ellipsis line limit.
            if (content.getBoundingClientRect().height <= 0) return false
            fullWidth = designerUnscaledTextWidth(content)
            fullHeight = Math.ceil(content.scrollHeight)
            exactOverflow = measureDesignerTextOverflow(node, content)
          },
          () => {
            const fallbackOverflow = designTextOverflow(node)
            const overflow: ReturnType<typeof designTextOverflow> =
              exactOverflow ? { ...exactOverflow, ...(fallbackOverflow?.nowrap ? { nowrap: true } : {}) } : fallbackOverflow
            if (overflow)
              Object.assign(content.style, {
                display: overflow.nowrap ? 'block' : '-webkit-box',
                ...(overflow.nowrap
                  ? {
                    width: `${node.width}px`,
                    whiteSpace: 'pre',
                    textOverflow: 'ellipsis',
                  }
                  : {
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: String(overflow.lines),
                  }),
                overflow: 'hidden',
                maxHeight: `${overflow.height}px`,
              })
            first.prepend(marker)
          },
          () => {
            visibleHeight = content.getBoundingClientRect().height
            baseline = marker.getBoundingClientRect().top - outer.getBoundingClientRect().top
          },
          () => {
            if (!active) return
            if (captureBaseline) onMeasure({ signature, baseline })
            onSize?.({
              width: fullWidth,
              height: fullHeight,
              visibleHeight,
              ...(exactOverflow ? { overflow: exactOverflow } : {}),
            })
          },
        ],
        cleanup: () => { outer.remove() },
      })
    }
    measure()
    const unwatch = watchDesignerFonts(measure)
    return () => {
      active = false
      unwatch()
    }
  }, [signature, overflowSignature, captureBaseline, engineCaches])
  return null
}
