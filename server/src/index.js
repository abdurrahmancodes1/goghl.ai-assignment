import express from 'express';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { connectDb } from './db.js';
import { config } from './config.js';
import { redis } from './redis.js';
import { startEvents, listeners } from './services/events.js';
import { verify, ingest, recoverExpired } from './services/webhooks.js';
import { runWorker } from './services/outbound.js';
import { grader } from './routes/grader.js';
import auth from './routes/auth.js';
import { Session, Conversation, Message, WorkspaceEvent } from './models.js';
import { enqueue } from './services/outbound.js';
import { publishEvent } from './services/events.js';

const app = express();
app.use('/webhooks/pigeon', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '64kb' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/__grader', grader);
app.use('/auth', auth);

function sessionId(req) { return req.headers.cookie?.match(/sb_session=([^;]+)/)?.[1]; }
async function session(req) { const id = sessionId(req); return id ? Session.findOne({ _id: id, expiresAt: { $gt: new Date() } }).lean() : null; }
function hasWorkspace(u, workspace) { return u?.workspaces?.some((x) => x.id === workspace); }

function isValidWebhookPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.id !== 'string' || !body.id) return false;
  if (!config.pigeon.keys[body.workspace]) return true;
  if (body.type === 'message.inbound') {
    return Boolean(body.data && typeof body.data.from === 'string' && body.data.from && typeof body.data.message_id === 'string' && body.data.message_id && !Number.isNaN(Date.parse(body.occurred_at)));
  }
  if (body.type === 'message.status') {
    return Boolean(body.data && typeof body.data.client_ref === 'string' && body.data.client_ref && typeof body.data.status === 'string' && body.data.status);
  }
  return true;
}

app.post('/webhooks/pigeon', async (req, res, next) => {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || !verify(raw, req.headers['x-pigeon-signature'])) return res.status(401).end();
  let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).end(); }
  if (!isValidWebhookPayload(body)) return res.status(400).end();
  try { await ingest(body); return res.status(200).end(); } catch (error) { return next(error); }
});
app.get('/api/me', async (req, res, next) => { try { const u = await session(req); if (!u) return res.status(401).end(); res.json({ sub: u.sub, workspaces: u.workspaces }); } catch (e) { next(e); } });
app.get('/api/conversations', async (req, res, next) => {
  try {
    const u = await session(req); if (!u) return res.status(401).end();
    const workspace = String(req.query.workspace || ''); if (!hasWorkspace(u, workspace)) return res.status(403).end();
    if (req.query.page === undefined && req.query.limit === undefined) {
      return res.json(await Conversation.find({ workspace }).sort({ lastActivityAt: -1, _id: -1 }).lean());
    }
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    const page = Math.max(Number.parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      Conversation.find({ workspace }).sort({ lastActivityAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Conversation.countDocuments({ workspace }),
    ]);
    return res.json({ items, page, limit, total, hasMore: skip + items.length < total });
  } catch (e) { next(e); }
});
app.get('/api/conversations/:contact/messages', async (req, res, next) => { try { const u = await session(req); const workspace = String(req.query.workspace || ''); if (!u) return res.status(401).end(); if (!hasWorkspace(u, workspace)) return res.status(403).end(); res.json(await Message.find({ workspace, contact: req.params.contact }).sort({ occurredAt: 1 }).lean()); } catch (e) { next(e); } });
app.post('/api/conversations/:contact/claim', async (req, res, next) => { try { const u = await session(req); const workspace = String(req.body.workspace || ''); if (!u) return res.status(401).end(); if (!hasWorkspace(u, workspace)) return res.status(403).end(); const agent = u.sub; const conversation = await Conversation.findOneAndUpdate({ workspace, contact: req.params.contact, $or: [{ assignee: null }, { assignee: agent }] }, { $set: { assignee: agent }, $setOnInsert: { workspace, contact: req.params.contact, state: 'open', lastActivityAt: new Date() } }, { upsert: true, new: true }).lean(); if (!conversation || conversation.assignee !== agent) return res.status(409).end(); await publishEvent(workspace, 'conversation.assigned', { contact: req.params.contact, assignee: agent }); res.json(conversation); } catch (e) { if (e.code === 11000) return res.status(409).end(); next(e); } });
app.post('/api/conversations/:contact/state', async (req, res, next) => {
  try {
    const u = await session(req); if (!u) return res.status(401).end();
    const workspace = String(req.body?.workspace || ''); if (!hasWorkspace(u, workspace)) return res.status(403).end();
    const state = req.body?.state;
    if (state !== 'open' && state !== 'closed') return res.status(400).end();
    const conversation = await Conversation.findOneAndUpdate({ workspace, contact: req.params.contact }, { $set: { state } }, { new: true }).lean();
    if (!conversation) return res.status(404).end();
    await publishEvent(workspace, 'conversation.state', { contact: req.params.contact, state });
    res.json(conversation);
  } catch (e) { next(e); }
});
app.post('/api/conversations/:contact/reply', async (req, res, next) => { try { const u = await session(req); const workspace = String(req.body.workspace || ''); const text = typeof req.body.text === 'string' ? req.body.text.trim() : ''; const clientRef = typeof req.body.client_ref === 'string' ? req.body.client_ref : crypto.randomUUID(); if (!u) return res.status(401).end(); if (!hasWorkspace(u, workspace)) return res.status(403).end(); if (!text || text.length > 4000) return res.status(400).end(); await enqueue({ workspace, contact: req.params.contact, text, clientRef }); res.status(202).json({ client_ref: clientRef }); } catch (e) { next(e); } });

function wsFrame(value) { const body = Buffer.from(JSON.stringify(value)); if (body.length < 126) return Buffer.concat([Buffer.from([0x81, body.length]), body]); return Buffer.concat([Buffer.from([0x81, 126, body.length >> 8, body.length & 255]), body]); }
function upgrade(req, socket) {
  const key = req.headers['sec-websocket-key']; const url = new URL(req.url || '/', `http://${req.headers.host}`); const workspace = url.searchParams.get('workspace');
  if (!key || !workspace) return socket.destroy();
  session({ headers: req.headers }).then(async (u) => {
    if (!hasWorkspace(u, workspace)) return socket.destroy();
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let last = Number(url.searchParams.get('after') || 0); let pumping = false; let closed = false;
    const pump = async () => { if (pumping || closed) return; pumping = true; try { for (;;) { const events = await WorkspaceEvent.find({ workspace, seq: { $gt: last } }).sort({ seq: 1 }).limit(100).lean(); if (!events.length) break; for (const event of events) { if (event.seq <= last) continue; socket.write(wsFrame({ ...event, ...event.payload })); last = event.seq; } } } finally { pumping = false; } };
    const notify = () => { pump().catch(() => socket.destroy()); };
    const set = listeners.get(workspace) || new Set(); set.add(notify); listeners.set(workspace, set);
    socket.on('close', () => { closed = true; set.delete(notify); }); socket.on('error', () => { closed = true; set.delete(notify); });
    await pump();
  }).catch(() => socket.destroy());
}
const server = createServer(app); server.on('upgrade', upgrade);
app.use((error, _req, res, _next) => { console.error(error); if (!res.headersSent) res.status(500).json({ error: 'internal_error' }); });
connectDb().then(startEvents).then(() => server.listen(config.port, () => { console.log(`assignment server on ${config.port}`); runWorker().catch((error) => console.error('worker stopped', error)); setInterval(() => recoverExpired().catch((error) => console.error('webhook recovery loop failed', error)), 2000).unref(); })).catch((error) => { console.error('startup failed', error); process.exit(1); });
