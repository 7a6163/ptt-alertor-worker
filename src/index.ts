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
    if (batch.queue === 'ptt-article-events') {
      await handleArticleBatch(batch as MessageBatch<ArticleEvent>, env);
    } else if (batch.queue === 'ptt-dispatch') {
      await handleDispatchBatch(batch as MessageBatch<DispatchEvent>, env);
    }
  },
} satisfies ExportedHandler<Env, ArticleEvent | DispatchEvent>;
