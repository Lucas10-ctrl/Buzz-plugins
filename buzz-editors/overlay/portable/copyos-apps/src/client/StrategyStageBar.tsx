/** Stage bar at the end of a strategy document: names the current stage, says what it needs, and starts the next one. */
import { useEffect, useRef } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CopyOSDocDocument } from '../../../copyos-domain/src/types.ts'
import { readStrategyDocument, readStrategySection, STRATEGY_STAGES, strategyStageProgress,
  type StrategyStageId } from '../../../copyos-domain/src/docs-strategy.ts'
import css from './StrategyBlocks.module.css'

type Translate = PropsLocale<'copyosFoundation'>['t']
type Key = Parameters<Translate>[0]

const NAMES: Readonly<Record<StrategyStageId, Key>> = {
  why: 'strategyStageWhy', metrics: 'strategyStageMetrics', data: 'strategyStageData', hypothesis: 'strategyStageHypothesis',
  idea: 'strategyStageIdea', order: 'strategyStageOrder', designs: 'strategyStageDesigns', copy: 'strategyStageCopy',
}
const HINTS: Readonly<Record<StrategyStageId, Key>> = {
  why: 'strategyStageHintWhy', metrics: 'strategyStageHintDecision', data: 'strategyStageHintData',
  hypothesis: 'strategyStageHintDecision', idea: 'strategyStageHintIdea', order: 'strategyStageHintDecision',
  designs: 'strategyStageHintDesigns', copy: 'strategyStageHintCopy',
}

/** Count the strategist's confirmations: confirmed decisions and confirmed page-section designs. */
function confirmations(document: Pick<CopyOSDocDocument, 'blocks'>): number {
  const decisions = [...readStrategyDocument(document.blocks).decisions.values()].filter(item => item.decision.status === 'confirmed')
  return decisions.length + document.blocks.filter(block => readStrategySection(block)?.status === 'confirmed').length
}

/**
 * Show the current strategy stage. Confirming the card that finishes a stage starts the next stage; confirming the Big Idea
 * asks the assistant for the Conversion narrative.
 * @param props - Saved document, whether a request can be sent now, and the request sender.
 * @returns The stage bar.
 */
export function StrategyStageBar(props: {
  readonly document: Pick<CopyOSDocDocument, 'id' | 'blocks'>
  readonly canAsk: boolean
  readonly busy: boolean
  readonly ask: (prompt: string, request: string) => void
  readonly t: Translate
}) {
  const { document, t } = props
  const progress = strategyStageProgress(document)
  const number = STRATEGY_STAGES.indexOf(progress.stage) + 1, name = t(NAMES[progress.stage])
  const writing = document.blocks.some(block => block.state === 'writing')
  const send = (kind: 'start' | 'continue'): void => {
    props.ask(t(kind === 'start' ? 'strategyStageStartAction' : 'strategyStageContinueAction',
      { number, stage: name, key: progress.stage, id: document.id }), kind === 'start' ? t('strategyStageStart', { stage: name }) : name)
  }
  const previous = useRef<{ stage: StrategyStageId; confirmed: number } | undefined>(undefined)
  const confirmed = confirmations(document)
  useEffect(() => {
    const before = previous.current
    previous.current = { stage: progress.stage, confirmed }
    if (!before || confirmed <= before.confirmed || !props.canAsk || props.busy || progress.finished) return
    if (before.stage !== progress.stage) send(progress.started ? 'continue' : 'start')
    else if (progress.stage === 'idea') send('continue')
  })
  const waiting = props.busy || writing
  const hint = progress.finished ? t('strategyStageHintDone') : waiting ? t('strategyStageWorking')
    : progress.started ? t(HINTS[progress.stage]) : t('strategyStageReady')
  return (
    <section className={css.stageBar} aria-label={progress.finished ? t('strategyStageDone') : name}>
      <div className={css.stageHead}>
        <span>{t('strategyStageProgress', { number, total: STRATEGY_STAGES.length })}</span>
        <ol className={css.stageDots} aria-hidden>
          {STRATEGY_STAGES.map((stage, index) => (
            <li key={stage} data-state={progress.finished || index < number - 1 ? 'done' : index === number - 1 ? 'current' : 'next'} />
          ))}
        </ol>
      </div>
      <strong className={css.stageName}>{progress.finished ? t('strategyStageDone')
        : progress.started ? name : t('strategyStageNext', { stage: name })}</strong>
      <p className={css.hint}>{hint}</p>
      {props.canAsk && !waiting && !(progress.started && progress.stage === 'why' && !progress.finished) ? (
        <div className={css.actions}>
          {progress.finished ? (
            <button type="button" className={css.primary}
              onClick={() => { props.ask(t('strategyStageBuildAction', { id: document.id }), t('strategyStageBuild')) }}>
              {t('strategyStageBuild')}
            </button>
          ) : progress.started ? (
            <button type="button" className={css.quiet} onClick={() => { send('continue') }}>{t('strategyStageContinue')}</button>
          ) : (
            <button type="button" className={css.primary} onClick={() => { send('start') }}>{t('strategyStageStart', { stage: name })}</button>
          )}
        </div>
      ) : null}
    </section>
  )
}
