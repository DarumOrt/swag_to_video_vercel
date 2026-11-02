/** Dev export worker with the WebGL2 test renderer (options arrive through `scene`). */

import { serveExport } from '../workerHost'
import { TestWebglRenderer } from './testWebglRenderer'

serveExport(() => new TestWebglRenderer())
