import { Hono } from 'hono';
import type { Env, ArticleEvent, DispatchEvent } from './env';
import { runChecker } from './jobs/checker';
import { handleArticleBatch } from './jobs/matcher';
import { handleDispatchBatch } from './jobs/dispatcher';
import { webhooks } from './routes/webhooks';
import { admin } from './routes/admin';

const app = new Hono<{ Bindings: Env }>();
app.get('/', (c) => c.text('ptt-alertor'));
app.route('/webhooks', webhooks);
app.route('/admin', admin);

export default {
  fetch: app.fetch,

  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runChecker(env));
  },

  async queue(
    batch: MessageBatch<ArticleEvent | DispatchEvent>,
    env: Env,
  ): Promise<void> {
    // Cloudflare types `batch.queue` as `string`, so a cast is unavoidable.
    // Centralising it in a switch with an explicit `default` keeps a new queue
    // from being silently dropped: it'll throw and exhaust retries to DLQ
    // instead of being acked as if delivered.
    switch (batch.queue) {
      case 'ptt-article-events':
        return handleArticleBatch(batch as MessageBatch<ArticleEvent>, env);
      case 'ptt-dispatch':
        return handleDispatchBatch(batch as MessageBatch<DispatchEvent>, env);
      default:
        throw new Error(`ptt-alertor: unhandled queue ${batch.queue}`);
    }
  },
} satisfies ExportedHandler<Env, ArticleEvent | DispatchEvent>;
