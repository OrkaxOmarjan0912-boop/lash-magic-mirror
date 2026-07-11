// Public surface of the lash engine package. The app (and the test harness)
// should only ever import from here — never reach into the internal modules.
export { createLashTryOnController } from "./controller";
export type {
  LashTryOnController,
  LashEvent,
  ControllerConfig,
  LashDebugController,
  LashTelemetry,
} from "./controller";
export type { DebugOverrides } from "./lash-renderer";
export type { OneEuroParams } from "./one-euro";
export { LASH_STYLES, styleById } from "./styles";
export type { LashStyle } from "./styles";
