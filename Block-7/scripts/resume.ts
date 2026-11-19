/**
 * npm run resume [-- <saga_id>]
 *   with saga_id : POST /sagas/:saga_id/resume  (drive that saga once, print it)
 *   without      : POST /admin/resume           (resume every unfinished saga)
 */
import { URLS } from "../src/shared/config.js";
import { http } from "./lib.js";

const sagaId = process.argv[2];
const url = sagaId ? `${URLS.order}/sagas/${encodeURIComponent(sagaId)}/resume` : `${URLS.order}/admin/resume`;

try {
  const { status, data } = await http("POST", url, {}, 20000);
  console.log(`POST ${url} -> HTTP ${status}`);
  console.log(JSON.stringify(data, null, 2));
  process.exit(status < 400 ? 0 : 1);
} catch (e: any) {
  console.error(`Order service not reachable at ${URLS.order} (${e.message}). Is it running? (npm run svc -- status)`);
  process.exit(1);
}
