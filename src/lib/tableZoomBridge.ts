import { createRequestBridge } from './bridgeFactory'

/** Publishes a rendered table snapshot from the CM6 widget into the React modal layer. */
export const tableZoomBridge = createRequestBridge<[html: string]>('tableZoomBridge')
