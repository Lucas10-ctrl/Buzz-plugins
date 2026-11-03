/** Numeric formula authoring compiles current CSS names into durable resource identities. */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CopyOSDesignDocument,
  CopyOSDesignNumberVariable,
} from '../../../copyos-domain/src/types.ts'
import {
  designCssNumber,
  designCssNumberRegistry,
  designNumberExpressionCss,
  designNumberExpressionReferences,
  designModeResources,
  resolveDesignNumberVariables,
  setDesignNumberVariable,
  resetDesignModeVariable,
  designTokenConfigurationValid,
} from '../../../copyos-domain/src/design-model.ts'
import type { CopyOSFoundationLocaleKey } from './locales.ts'
import {
  DesignerExpressionDraft,
  type DesignerExpressionEvaluation,
} from './DesignerExpressionDraft.tsx'
import css from './DesignerExpressionDraft.module.css'
type Translate = (key: CopyOSFoundationLocaleKey) => string

/** Edit one resource formula locally, with all-mode/native-binding validation before any commit.
 * @param props - Stored document, effective numeric resource and normal resource transaction callback.
 * @returns An inline formula disclosure, dependency/result draft and source ownership actions.
 */
export function DesignerNumberExpression({
  doc,
  variable,
  inherited,
  t,
  commit,
}: {
  doc: CopyOSDesignDocument
  variable: CopyOSDesignNumberVariable
  inherited: boolean
  t: Translate
  commit: (document: CopyOSDesignDocument) => boolean | void
}): ReactNode {
  const [session, setSession] = useState<{
    document: CopyOSDesignDocument
    generation: number
  } | null>(null)
  const serial = useRef(0),
    trigger = useRef<HTMLButtonElement>(null)
  const current = session?.document === doc ? session : null
  const open = !!current
  const registry = useMemo(
    () =>
      open
        ? designCssNumberRegistry(doc)
        : {
          byId: new Map<string, string>(),
          byName: new Map<string, string>(),
          ambiguous: new Set<string>(),
        },
    [doc, open],
  )
  const resolved = useMemo(
    () => (open ? resolveDesignNumberVariables(designModeResources(doc).numberVariables) : []),
    [doc, open],
  )
  const byId = useMemo(() => new Map(resolved.map(item => [item.id, item])), [resolved])
  const mode = doc.tokenModes?.find(item => item.id === doc.activeTokenModeId)
  const close = (): void => {
    setSession(null)
    trigger.current?.focus()
  }
  const parse = (source: string) => {
    const parsed = designCssNumber(source, {
      rootFontSize: null,
      compile: true,
      lookup: (name) => {
        const id = registry.byName.get(name),
          value = id ? byId.get(id) : undefined
        return value ? { value: value.value, unit: value.unit, referenceId: value.id } : 'other'
      },
    })
    if (!parsed?.expression || parsed.unit !== variable.unit) return
    const candidate = setDesignNumberVariable(doc, variable.id, {
      expression: parsed.expression,
      aliasId: null,
    })
    if (!designTokenConfigurationValid(candidate)) return
    return { parsed, candidate, expression: parsed.expression }
  }
  const evaluate = (source: string): DesignerExpressionEvaluation => {
    const result = parse(source)
    return result
      ? {
        valid: true,
        result: `${result.parsed.value}${result.parsed.unit === 'px' ? 'px' : ''}`,
        dependencies: designNumberExpressionReferences(result.expression).map(id => ({
          id,
          name: byId.get(id)?.name ?? '',
        })),
      }
      : { valid: false, error: t('designerExpressionInvalid') }
  }
  const initial = !current
    ? ''
    : variable.expression
      ? designNumberExpressionCss(
        variable.expression,
        id => registry.byId.get(id) ?? `--copyos-${id}`,
      )
      : variable.aliasId
        ? `var(${registry.byId.get(variable.aliasId) ?? `--copyos-${variable.aliasId}`})`
        : `${variable.value}${variable.unit === 'px' ? 'px' : ''}`
  const ownCandidate = current
    ? setDesignNumberVariable(doc, variable.id, {
      value: variable.value,
      aliasId: null,
      expression: null,
    })
    : null
  const ownAllowed = !!ownCandidate && designTokenConfigurationValid(ownCandidate)
  const inheritCandidate =
    current && mode ? resetDesignModeVariable(doc, 'number', variable.id) : null
  const inheritAllowed = !!inheritCandidate && designTokenConfigurationValid(inheritCandidate)
  const own = (): void => {
    if (ownAllowed && commit(ownCandidate) !== false) close()
  }
  return (
    <div className={css.resource}>
      <button
        ref={trigger}
        type="button"
        className={css.trigger}
        aria-label={t('designerExpressionFor').replace('{name}', variable.name)}
        aria-expanded={!!current}
        data-formula={!!variable.expression}
        onClick={() => {
          setSession(current ? null : { document: doc, generation: ++serial.current })
        }}
      >
        {t('designerFunctionSymbol')}
        {variable.expression && mode
          ? ` · ${inherited ? t('designerExpressionInherited') : t('designerLocalSizing')}`
          : ''}
      </button>
      {current ? (
        <>
          <DesignerExpressionDraft
            key={current.generation}
            value={initial}
            t={t}
            variables={resolved
              .filter(item => item.id !== variable.id)
              .map(item => ({
                id: item.id,
                name: item.name,
                reference: `var(${registry.byId.get(item.id) ?? `--copyos-${item.id}`})`,
              }))}
            evaluate={evaluate}
            onCancel={close}
            onApply={(source) => {
              if (current.document !== doc) return false
              const result = parse(source)
              if (!result || commit(result.candidate) === false) return false
              close()
              return true
            }}
          />
          <div className={css.actions}>
            <button
              type="button"
              onClick={own}
              disabled={!ownAllowed}
              title={ownAllowed ? undefined : t('designerExpressionInvalid')}
            >
              {t('designerOwnValue')}
            </button>
            {mode ? (
              <button
                type="button"
                disabled={!inheritAllowed}
                title={inheritAllowed ? undefined : t('designerExpressionInvalid')}
                onClick={() => {
                  if (inheritAllowed && commit(inheritCandidate) !== false)
                    close()
                }}
              >
                {t('designerInheritBase')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
