# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Cloudflare Workers rewrite of the Go project ptt-alertor: crawls PTT boards every minute and pushes new-article notifications to subscribers via Telegram. LINE / Messenger / Mail are single-function stubs in `src/channels/`. Bot-facing text is Traditional Chinese. README.md has the setup walkthrough, the Go→Workers mapping table, and the Telegram command grammar.

## Commands

```
pnpm install
pnpm dev                 # wrangler dev (needs pnpm db:migrate:local first)
pnpm test                # vitest run — all tests
pnpm vitest run tests/parser.test.ts        # one file
pnpm vitest run -t "parses help variants"   # one test by name
pnpm typecheck           # tsc --noEmit (strict + noUncheckedIndexedAccess)
pnpm deploy
pnpm db:migrate:local | pnpm db:migrate:remote   # apply migrations/*.sql to D1
```

The lockfile is `pnpm-lock.yaml`; if `pnpm` is not on PATH, `npx pnpm <cmd>` or `corepack pnpm <cmd>` works. There is no linter. Tests are pure unit tests (parser, crawler HTML parsing, keyword matching) with no D1/queue bindings; code that touches `env.DB` or queues is untested.

Secrets live in `.dev.vars` locally and `wrangler secret put` in prod; the list is commented at the bottom of `wrangler.toml`. `TELEGRAM_WEBHOOK_SECRET` is fail-closed: the webhook returns 503 if unset.

## Architecture

Single Worker (`src/index.ts`) exporting three handlers; `Env` in `src/env.ts` is the shared binding/event type source.

**Pipeline** (two Cloudflare Queues chained; names are hard-coded in the `switch` in `index.ts` and must match `wrangler.toml`):

1. `scheduled` → `runChecker` (`src/jobs/checker.ts`): sweeps `boards` oldest `last_checked_at` first under a 45s budget (so a sweep never overlaps the next tick; skipped boards go first next minute), fetches each index, inserts unseen articles into D1 with `enqueued_at = NULL`, sends them to `ARTICLE_QUEUE` in chunks of 50 (Queues cap 100 msgs, D1 caps 100 binds), stamping `enqueued_at` per chunk. Rows left NULL by a crash are re-enqueued on the next sweep of that board. A board's first sweep (`last_article_id IS NULL`) and any post whose id timestamp is over 7 days old (pinned posts, purged-and-rescraped rows) are stored as already enqueued, never notified. Each sweep ends by purging enqueued articles older than 90 days. Sequential with a per-board sleep (slower during 03–07 Taiwan time).
2. `ptt-article-events` → `handleArticleBatch` (`src/jobs/matcher.ts`): loads a board's `keyword_subs` / `author_subs` (joined with `channel_bindings` + `users.enabled`) once per batch, then `findMatches` emits at most one `DispatchEvent` per (user, channel) per article to `DISPATCH_QUEUE`. Acks only after the downstream sendBatch succeeds.
3. `ptt-dispatch` → `handleDispatchBatch` (`src/jobs/dispatcher.ts`): routes by `evt.channel` to `src/channels/*.ts`. A `PermanentChannelError` (`src/errors.ts`, thrown by the Telegram adapter on non-429 4xx) is acked and logged; anything else retries with a 30s delay and eventually lands in `ptt-dlq`.

**Keyword semantics**: `matchesKeyword` in matcher.ts — case-insensitive substring; a stored keyword may contain spaces, each space-separated term must appear (AND). Separate keyword rows are OR. The parser (`splitKeywordItems`) preserves intra-item whitespace for keywords but splits authors on whitespace too, so keep parser and matcher in sync when touching either.

**Telegram bot** (`src/routes/webhooks.ts`): `parseCommand` (`src/command/parser.ts`) → `applyCommand` (`src/command/apply.ts`) → reply. Once the secret header checks out the handler always returns 200 and only logs errors, because Telegram redelivers non-2xx updates forever. Two interactive flows are deliberately stateless (no conversation table):
- Guided `/add` / `/addauthor` (subscribe only): state is encoded in the `force_reply` prompt text and recovered via `detectGuidedMode(reply_to_message.text)` when the replied-to message is from the bot, and in inline `callback_data` (`g:sub:kw` etc.). Changing `guidePromptTitle` or the callback format breaks in-flight prompts.
- Tap-to-delete `/del` / `/delauthor`: `callback_data` carries only the D1 `rowid` (Telegram caps callback_data at 64 bytes), and the menu is re-rendered in place with `editMessageText`.

Users are keyed as `${channel}:${externalId}` (`ensureUserAndBinding`); `channel_bindings` maps a channel's external id back to the user. `MAX_ITEMS_PER_COMMAND = 20` caps fan-out per command and the reply notes truncation.

**Telegram API** (`src/telegram/api.ts`): all calls go through `callTelegram`, which scrubs the bot token from error bodies. Add new Bot API methods there, not with raw `fetch`.

**Admin** (`src/routes/admin.ts`): Basic auth from `ADMIN_BASIC_AUTH` (base64 `user:pass`). Boards are only created via `POST /admin/boards` or implicitly by `ensureBoard` when a user subscribes. PTT paths are case-insensitive but article ids are global, so `ensureBoard` resolves the typed name to the canonical spelling (case-insensitive hit on `boards`, else the page's topbar link via `fetchBoardName`) and rejects names PTT doesn't serve. Stored board names are always canonical; text unsubscribe compares with `COLLATE NOCASE`. `POST /admin/telegram/setup` registers the slash-command menu and the webhook in one call.

**Schema**: `migrations/0001_init.sql` + `0002_articles_enqueued_at.sql`. Add a new numbered file for schema changes; never edit existing ones.

## Conventions

- Logging is `console.*` only; read with `wrangler tail`. Catch blocks in queue handlers must end in `msg.ack()` or `msg.retry()`, never fall through.
- Crawler (`src/crawler/ptt.ts`) parses PTT HTML with regexes and emits one aggregated `console.warn` for malformed `<r-ent>` blocks instead of throwing; tests assert on that warn payload.
- Adding a channel: implement `send<Channel>(env, evt)` in `src/channels/`, add the case in `dispatcher.ts`, extend the `Channel` union in `env.ts`, and throw `PermanentChannelError` for non-retryable upstream rejections.
