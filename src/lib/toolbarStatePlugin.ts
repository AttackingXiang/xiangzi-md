import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { computeToolbarState, toolbarStateBridge } from './toolbarStateBridge'

export const toolbarStatePlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('xmd-toolbar-state'),
      view() {
        return {
          update(view) {
            toolbarStateBridge.notify(computeToolbarState(view.state))
          },
          destroy() {
            toolbarStateBridge.reset()
          },
        }
      },
    }),
)
