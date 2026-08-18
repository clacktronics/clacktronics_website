/* A pool of frame filters.
 *
 * Frames of video do not depend on one another, which is the one piece of luck
 * this whole feature rests on: the filters are single-threaded and some of them
 * are slow, but eight of them can run on eight frames at once and the wall
 * clock divides. Pixel Sorting is around 85 ms for a 720p frame on a modest
 * machine, so a ten-second clip is three hundred frames and twenty-five
 * seconds of work — or three seconds spread over the cores most people have.
 *
 * The queue is deliberately dumb. Callers hand over frames as fast as they can
 * decode them, each worker takes the next job whenever it finishes one, and
 * the results come back through per-job promises rather than in order, because
 * the caller knows which frame is which and the pool does not need to.
 */

const WORKER_URL = new URL('./fx-worker.js', import.meta.url);

/* One worker per core, minus the one the page itself is using, and never more
   than eight: past that the memory each in-flight frame costs outweighs the
   core it would use, and a 4K frame is 33 MB before any filter allocates. */
const poolSize = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

export class FxPool {
  constructor({ size = poolSize() } = {}) {
    this.size = size;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.jobs = new Map();
    this.token = 0;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i += 1) {
      const worker = new Worker(WORKER_URL);
      worker.onmessage = event => this.receive(worker, event.data || {});
      /* A worker that fails to boot at all — the shared filter files moved,
         say — must not leave callers waiting on a promise that never settles. */
      worker.onerror = event => this.fail(worker, event.message || 'The frame filter failed to start.');
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  receive(worker, message) {
    if (message.type === 'ready') return;
    const job = this.jobs.get(message.token);
    this.jobs.delete(message.token);
    this.idle.push(worker);
    if (job) {
      if (message.type === 'done') job.resolve(new ImageData(new Uint8ClampedArray(message.data), message.width, message.height));
      else job.reject(new Error(message.message || 'The frame filter failed.'));
    }
    this.pump();
  }

  fail(worker, reason) {
    for (const [token, job] of [...this.jobs]) {
      if (job.worker !== worker) continue;
      this.jobs.delete(token);
      job.reject(new Error(reason));
    }
    if (!this.idle.includes(worker)) this.idle.push(worker);
    this.pump();
  }

  pump() {
    while (this.queue.length && this.idle.length) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      job.worker = worker;
      this.jobs.set(job.token, job);
      worker.postMessage({ type: 'render', token: job.token, ...job.payload }, [job.payload.data]);
    }
  }

  /* The frame's pixels are handed over, not lent: the ImageData passed in is
     detached by the transfer and must not be read afterwards. */
  render(image, stack, colours) {
    this.start();
    const token = this.token += 1;
    const data = image.data.buffer;
    return new Promise((resolve, reject) => {
      this.queue.push({
        token, resolve, reject,
        payload: { width: image.width, height: image.height, data, stack, colours }
      });
      this.pump();
    });
  }

  /* Abandon everything queued and not yet sent. Jobs already inside a worker
     are left to finish and their results dropped — a filter mid-frame cannot
     be interrupted, and tearing the worker down to save those milliseconds
     costs more in restarting it. */
  cancel(reason = 'Cancelled.') {
    for (const job of this.queue.splice(0)) job.reject(new Error(reason));
    for (const [token, job] of [...this.jobs]) {
      this.jobs.delete(token);
      job.reject(new Error(reason));
    }
  }

  destroy() {
    this.cancel('The effect pool was shut down.');
    for (const worker of this.workers.splice(0)) worker.terminate();
    this.idle.length = 0;
    this.started = false;
  }
}
