import { lazy } from 'react'

// Purely cosmetic overlay chrome that renders nothing until scroll metrics
// arrive on mount, so a lazy chunk costs no more than one extra tick — kept
// out of the entry bundle to stay under scripts/check-bundle-budget.mjs.
// Shared by Sidebar and TabBar so the dynamic-import wrapper is defined once.
const HoverScrollbars = lazy(() => import('./HoverScrollbars'))
export default HoverScrollbars
