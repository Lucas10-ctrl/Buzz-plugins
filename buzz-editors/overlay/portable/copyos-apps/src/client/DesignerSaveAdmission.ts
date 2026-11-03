/** Numeric callbacks report acceptance only while the owning Workspace settles an explicit Save. */
import { createContext } from 'react'

/** Return true only during Save settlement; other edits keep their established blur contract. */
export const DesignerSaveAdmission = createContext<((accepted: boolean) => boolean) | null>(null)
