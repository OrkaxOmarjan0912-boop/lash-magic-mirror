// Public surface of the lash engine package. The app (and the test harness)
// should only ever import from here — never reach into the internal modules.
export { createLashTryOnController } from "./controller";
export type { LashTryOnController, LashEvent, ControllerConfig } from "./controller";
export { LASH_STYLES, styleById } from "./styles";
export type { LashStyle } from "./styles";
