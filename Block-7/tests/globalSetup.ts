import { ensureCtl } from "../scripts/lib.js";

/** Uses a running ctl if there is one, otherwise spawns scripts/ctl.ts and stops it after the run. */
export default async function setup() {
  const stop = await ensureCtl();
  return async () => {
    await stop();
  };
}
