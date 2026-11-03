import type { CopyOSWorkflowId } from '../../../copyos-domain/src/types.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'

/** One user-facing CopyOS workspace choice shared by project and blank-session launchers. */
export interface CopyOSWorkflowChoice {
  readonly id: CopyOSWorkflowId
  readonly title: CopyOSFoundationLocaleKey
  readonly description: CopyOSFoundationLocaleKey
  readonly prompt: CopyOSFoundationLocaleKey
  readonly example: CopyOSFoundationLocaleKey
  readonly mark: string
}

/** Canonical CopyOS session choices in product order. */
export const COPYOS_WORKFLOWS: readonly CopyOSWorkflowChoice[] = [
  { id: 'docs', title: 'docsTitle', description: 'docsDescription', prompt: 'docsPrompt', example: 'docsExample', mark: '▧' },
  { id: 'landing-page-builder', title: 'workflowLandingPage', description: 'workflowLandingPageDescription', prompt: 'workflowLandingPagePrompt', example: 'workflowLandingPageExample', mark: '▤' },
  { id: 'canvas', title: 'workflowCanvas', description: 'workflowCanvasDescription', prompt: 'workflowCanvasPrompt', example: 'workflowCanvasExample', mark: '◇' },
  { id: 'copywriter', title: 'workflowCopywriter', description: 'workflowCopywriterDescription', prompt: 'workflowCopywriterPrompt', example: 'workflowCopywriterExample', mark: '✎' },
  { id: 'strategy', title: 'workflowStrategyBuilder', description: 'workflowStrategyBuilderDescription', prompt: 'workflowStrategyBuilderPrompt', example: 'workflowStrategyBuilderExample', mark: '◎' },
  { id: 'cro-analyst', title: 'workflowCro', description: 'workflowCroDescription', prompt: 'workflowCroPrompt', example: 'workflowCroExample', mark: '↗' },
  { id: 'ad-scriptwriter', title: 'workflowAdScript', description: 'workflowAdScriptDescription', prompt: 'workflowAdScriptPrompt', example: 'workflowAdScriptExample', mark: '▶' },
  { id: 'creative-strategist', title: 'workflowStrategist', description: 'workflowStrategistDescription', prompt: 'workflowStrategistPrompt', example: 'workflowStrategistExample', mark: '✦' },
  { id: 'researcher', title: 'workflowResearcher', description: 'workflowResearcherDescription', prompt: 'workflowResearcherPrompt', example: 'workflowResearcherExample', mark: '⌕' },
]
