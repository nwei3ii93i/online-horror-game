/**
 * Off-main-thread renderer for the sound bank. Receives [id, variation] jobs (sounds and
 * reverb impulse responses) and posts back each result (channels are transferred, not copied).
 */
import { renderJob, type Job } from './SoundBank';

interface RenderRequest {
  jobs: Job[];
  rate: number;
}

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<RenderRequest>) => void) | null;
  postMessage(msg: unknown, opts?: { transfer?: Transferable[] }): void;
};

scope.onmessage = (ev) => {
  const { jobs, rate } = ev.data;
  for (const job of jobs) {
    const [id, v] = job;
    try {
      const r = renderJob(job, rate);
      scope.postMessage({ id, v, rate: r.rate, channels: r.channels, bad: r.bad }, { transfer: r.channels.map((c) => c.buffer) });
    } catch (e) {
      scope.postMessage({ id, v, error: String(e) });
    }
  }
  scope.postMessage({ done: true });
};
