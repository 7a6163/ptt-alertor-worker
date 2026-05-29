import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from '../env';

export const admin = new Hono<{ Bindings: Env }>();

admin.use('*', async (c, next) => {
  const expected = c.env.ADMIN_BASIC_AUTH;
  if (!expected) return c.text('admin disabled', 503);
  // atob throws InvalidCharacterError on non-base64 input. Treat that as a
  // configuration problem (503), not an internal error (500), so an operator
  // who pasted the raw "user:pass" instead of base64 sees a useful signal.
  let decoded: string;
  try {
    decoded = atob(expected);
  } catch {
    return c.text('admin misconfigured: ADMIN_BASIC_AUTH is not valid base64', 503);
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return c.text('admin misconfigured: expected base64 of "user:pass"', 503);
  const username = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);
  return basicAuth({ username, password })(c, next);
});

admin.get('/users', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT id, created_at, enabled FROM users ORDER BY created_at DESC`,
  ).all();
  return c.json(res.results);
});

admin.get('/boards', async (c) => {
  const res = await c.env.DB.prepare(`SELECT * FROM boards ORDER BY name`).all();
  return c.json(res.results);
});

admin.post('/boards', async (c) => {
  const { name, isHighTraffic } = await c.req.json<{ name: string; isHighTraffic?: boolean }>();
  if (!name) return c.text('missing name', 400);
  await c.env.DB.prepare(
    `INSERT INTO boards (name, last_checked_at, is_high_traffic) VALUES (?, 0, ?)
     ON CONFLICT(name) DO UPDATE SET is_high_traffic = excluded.is_high_traffic`,
  ).bind(name, isHighTraffic ? 1 : 0).run();
  return c.json({ ok: true });
});

admin.delete('/boards/:name', async (c) => {
  await c.env.DB.prepare(`DELETE FROM boards WHERE name = ?`).bind(c.req.param('name')).run();
  return c.json({ ok: true });
});
