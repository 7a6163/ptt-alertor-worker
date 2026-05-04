# ptt-alertor-worker

Cloudflare Workers rewrite of [ptt-alertor](https://github.com/Ptt-Alertor/ptt-alertor) — crawls PTT for new articles and pushes notifications via Telegram. LINE / Messenger / Mail are stubbed (single-function extension points).

## Architecture

```
Cron Trigger (every minute)
  └─ runChecker (src/jobs/checker.ts)
       ├─ fetchBoardIndex (src/crawler/ptt.ts)
       ├─ diff against D1 articles
       └─ enqueue → ARTICLE_QUEUE
             └─ handleArticleBatch (src/jobs/matcher.ts)
                  ├─ resolve keyword/author subs from D1
                  └─ enqueue → DISPATCH_QUEUE
                        └─ handleDispatchBatch (src/jobs/dispatcher.ts)
                              ├─ telegram (full)
                              ├─ line      (stub)
                              ├─ messenger (stub)
                              └─ mail      (stub)

Webhooks
  POST /webhooks/telegram/:secret   parser → apply → D1
Admin (basic auth, base64 in ADMIN_BASIC_AUTH)
  GET    /admin/users
  GET    /admin/boards
  POST   /admin/boards
  DELETE /admin/boards/:name
```

## Mapping from the Go original

| Go (ptt-alertor)                | Workers version                         |
| ------------------------------- | --------------------------------------- |
| jobs/checker.go goroutine       | Cron Trigger + runChecker               |
| messageWorker pool of 300       | Cloudflare Queue with batching          |
| models/board (DynamoDB)         | D1 boards / articles tables             |
| models/user (Redis)             | D1 users + channel_bindings             |
| models/keyword, models/author   | D1 keyword_subs / author_subs           |
| command/command.go              | src/command/parser.ts + apply.ts        |
| channels/{telegram,line,...}    | src/channels/*.ts                       |
| PttMonitor 3-strike restart     | dropped; cron retries each minute       |

## Setup

```
pnpm install   # or npm install / yarn

pnpm db:create                   # paste returned id into wrangler.toml
pnpm db:migrate:local            # for local wrangler dev
pnpm db:migrate:remote           # for production

wrangler queues create ptt-article-events
wrangler queues create ptt-dispatch
wrangler queues create ptt-dlq

wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put ADMIN_BASIC_AUTH    # echo -n "user:pass" | base64

pnpm dev
pnpm deploy
```

## Telegram

After deploying, register the webhook. The `secret_token` is sent back by Telegram on every request as the `X-Telegram-Bot-Api-Secret-Token` header, which the Worker validates (fail-closed if `TELEGRAM_WEBHOOK_SECRET` is not set):

```
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-worker>.workers.dev/webhooks/telegram" \
  --data-urlencode "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Talk to your bot:

```
新增 Stock 關鍵字 台積電,聯電
刪除 Stock 關鍵字 聯電
新增 Gossiping 作者 someuser
清單
help
```

## Tests

```
pnpm test
pnpm typecheck
```

## Caveats

- Workers Free has a 30s wall-time cap on scheduled events. Many boards x per-board delay can exceed it; bump to Workers Paid or shard boards across multiple cron expressions.
- Queues require the Workers Paid plan ($5/mo).
- Push count and comment trackers from the Go version are not yet ported. Extend `runChecker` to enqueue new event kinds and add handlers in `matcher.ts`.
- Cloudflare may rate-limit outbound `fetch` on the Free plan.

## Known issues / TODO

Found during initial code review. None block local-dev usage; address before serious production traffic.

- **Checker write/enqueue is not atomic** (`src/jobs/checker.ts`). If the Worker is killed between `DB.batch(inserts)` and `ARTICLE_QUEUE.sendBatch`, articles land in D1 but are never matched, and the next cron skips them as known. Fix by enqueuing first or by tracking an `enqueued_at` column to recover unmatched rows.
- **Admin basic-auth crashes on malformed secret** (`src/routes/admin.ts`). `atob(ADMIN_BASIC_AUTH)` throws if the value isn't valid base64, surfacing as a 500 with an internal error. Wrap in try/catch and return 503.
- **Command parser has no item cap** (`src/command/parser.ts`). A user sending thousands of comma-separated keywords would trigger thousands of D1 INSERTs in `applyCommand`. Cap items per command (~20) before batching.
- **Dispatcher retries on permanent failures** (`src/jobs/dispatcher.ts`). All errors `retry({delaySeconds:30})`; a 4xx from Telegram (e.g. user blocked the bot) wastes 5 retries before DLQ. Distinguish: ack on 4xx, retry on 5xx/network.
- **Queue type cast in entry point** (`src/index.ts`). The `as MessageBatch<…>` cast inside the `queue` handler bypasses TypeScript; if a third queue is added and the `else if` chain misses it, the wrong handler runs silently. Replace with discriminated dispatch + exhaustiveness check.
- **`noUncheckedIndexedAccess` is off** (`tsconfig.json`). `fresh[0].id` etc. are guarded today but the compiler won't catch future refactors that lose the guard. Turn the flag on and adjust call sites.
- **HTML parser silently drops malformed entries** (`src/crawler/ptt.ts`). Both `linkMatch` and `idMatch` `continue` on miss; if PTT changes its markup, articles vanish without a signal. Add a counter / `console.warn` for parse failures.
