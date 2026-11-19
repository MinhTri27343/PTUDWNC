/**
 * npm run reset — POST /ctl/reset: starts any stopped service, clears all armed faults
 * (DELETE /admin/faults) and re-seeds all 3 DBs (POST /admin/reset). Requires ctl (npm start).
 */
import { CtlUnavailableError, ctl } from "./lib.js";

try {
  const r = await ctl.reset();
  console.log(JSON.stringify(r, null, 2));
  console.log(r.ok ? "reset OK" : "reset finished WITH ERRORS");
  process.exit(r.ok ? 0 : 1);
} catch (e: any) {
  if (e instanceof CtlUnavailableError) console.error(e.message);
  else console.error(`reset failed: ${e.message}${e.data ? "\n" + JSON.stringify(e.data, null, 2) : ""}`);
  process.exit(1);
}
