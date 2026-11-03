/** Machine-readable fidelity diagnostics for selected-layer CSS handoff. */
export const DESIGN_NODE_CSS_WARNING_CODES = ['preserved-layout', 'negative-gap', 'wrap-fill', 'legacy-auto-spacing', 'grid-placement',
  'css-typed-arithmetic', 'css-container-units', 'text-layout', 'paragraph-spacing', 'layer-compositing', 'constraint-layout', 'instance-scale', 'box-model',
  'image-transform', 'font-availability', 'mode-context', 'svg-paint', 'svg-stroke', 'svg-geometry'] as const
/** External context needed to apply one selected-layer snippet. */
export const DESIGN_NODE_CSS_REQUIREMENT_CODES = ['token-css', 'mode-scope', 'parent-layout', 'positioned-parent',
  'svg-renderer', 'font-resource', 'text-link-markup'] as const
/** Stable warning identity; messages are developer-facing and UI labels can localize the code. */
export interface DesignNodeCssWarning {
  code: typeof DESIGN_NODE_CSS_WARNING_CODES[number]
  property?: string | undefined
  message: string
}
/** Required surrounding resource, layout or graphics context. */
export interface DesignNodeCssRequirement {
  code: typeof DESIGN_NODE_CSS_REQUIREMENT_CODES[number]
  property?: string | undefined
  message: string
}
/** One selected stored layer or contextual descendant; node-assigned modes retain precedence. */
export interface DesignNodeCssOptions {
  nodeId: string
  instancePath?: readonly string[] | undefined
  documentModeId?: string | null | undefined
}
/** Read-only CSS declarations and explicit fidelity limits; the returned selector never contains authored layer names. */
export interface DesignNodeCssProjection {
  nodeId: string
  instancePath: string[]
  overridePath?: string[] | undefined
  effectiveModeId: string | null
  selector: string
  declarations: { property: string; value: string }[]
  css: string
  tokenReferences: { kind: 'color' | 'number'; id: string; name: string; cssName: string }[]
  requirements: DesignNodeCssRequirement[]
  warnings: DesignNodeCssWarning[]
}
