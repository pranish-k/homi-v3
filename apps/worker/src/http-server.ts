/**
 * HTTP surface for WORKER_MODE=http (HOMI-14). On Cloud Run a poll loop
 * would need always-allocated CPU (~$60/mo), so Cloud Scheduler POSTs
 * /tick and /prune on the cadence the loop used and the instance scales
 * to zero between runs. Platform IAM (OIDC run.invoker) keeps the
 * endpoints private - no in-app auth.
 *
 * The handler maps a job's outcome to the HTTP status: a run that failed
 * answers 5xx so Cloud Scheduler sees the failure (its retry and
 * alerting key on non-2xx). A blanket 200 would make every invocation
 * look successful and defeat the worker's rule "alert when the job did
 * not run, not only on errors".
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

// A job returns true when the run succeeded or was intentionally skipped
// (an overlapping run is already in flight), false when a run executed
// and threw. Jobs never reject - they log and translate to false - but
// the handler still guards rejection so a future throwing path cannot
// leave the request hanging.
export type Job = () => Promise<boolean>;

export function createRequestHandler(jobs: { tick: Job; prune: Job }) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const respond = (status: number, body: string) => {
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/healthz') return respond(200, 'ok');
    if (req.method !== 'POST') return respond(405, 'method not allowed');
    const run = (job: Job, name: string) => {
      job()
        .then((ok) => respond(ok ? 200 : 500, ok ? `${name} done` : `${name} failed`))
        .catch((err) => {
          console.error(`[worker] ${name} handler crashed`, err);
          respond(500, `${name} error`);
        });
    };
    if (req.url === '/tick') return run(jobs.tick, 'tick');
    if (req.url === '/prune') return run(jobs.prune, 'prune');
    return respond(404, 'not found');
  };
}
