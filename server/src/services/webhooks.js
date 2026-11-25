import crypto from 'node:crypto';
import { config } from '../config.js';
import { WebhookEvent, Conversation, Message } from '../models.js';
import { publishEvent } from './events.js';

export function verify(raw, value) {
  const m = value?.match(/^t=(\d+),v1=([0-9a-f]+)$/i);
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const h = crypto.createHmac('sha256', config.pigeon.secret).update(`${m[1]}.`).update(raw).digest('hex');
  return h.length === m[2].length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(m[2]));
}

async function claimEvent(body) {
  const key = { provider: 'pigeon', eventId: body.id };
  const owner = crypto.randomUUID();
  try {
    await WebhookEvent.create({ ...key, payload: body, state: 'processing', processingOwner: owner, processingUntil: new Date(Date.now() + 10000), receivedAt: new Date() });
    return { owner, body };
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const existing = await WebhookEvent.findOne(key).lean();
  if (!existing || existing.state === 'done') return null;
  if (existing.processingUntil && existing.processingUntil > new Date()) return null;
  const claimed = await WebhookEvent.findOneAndUpdate({ _id: existing._id, state: 'processing', processingUntil: { $lte: new Date() } }, { $set: { processingOwner: owner, processingUntil: new Date(Date.now() + 10000) } }, { new: true }).lean();
  return claimed ? { owner, body: claimed.payload } : null;
}

export async function ingest(body) {
  const claim = await claimEvent(body);
  if (!claim) return;
  const b = claim.body;
  const d = b.data || {};
  if (b.type === 'message.inbound' && config.pigeon.keys[b.workspace]) {
    const occurredAt = new Date(b.occurred_at);
    await Conversation.findOneAndUpdate({ workspace: b.workspace, contact: d.from }, { $setOnInsert: { workspace: b.workspace, contact: d.from, assignee: null, state: 'open' }, $max: { lastActivityAt: occurredAt } }, { upsert: true });
    const result = await Message.updateOne({ workspace: b.workspace, providerMessageId: d.message_id }, { $setOnInsert: { workspace: b.workspace, contact: d.from, direction: 'inbound', providerMessageId: d.message_id, text: d.text, occurredAt } }, { upsert: true });
    if (result.acknowledged) await publishEvent(b.workspace, 'message.inbound', { contact: d.from, message_id: d.message_id }, `inbound:${d.message_id}`);
  } else if (b.type === 'message.status' && config.pigeon.keys[b.workspace]) {
    const message = await Message.findOne({ workspace: b.workspace, clientRef: d.client_ref, direction: 'outbound' });
    if (message) {
      const rank = { queued: 0, sent: 1, delivered: 2, failed: 2 };
      const advances = d.status === 'delivered' || (d.status === 'failed' && message.status !== 'delivered') || rank[d.status] > rank[message.status || 'queued'];
      if (advances) { await Message.updateOne({ _id: message._id }, { $set: { status: d.status } }); await publishEvent(b.workspace, 'message.status', { contact: message.contact, client_ref: d.client_ref, status: d.status }, `status:${b.id}`); }
    }
  }
  await WebhookEvent.updateOne({ provider: 'pigeon', eventId: b.id, processingOwner: claim.owner }, { $set: { state: 'done', processedAt: new Date(), processingUntil: null } });
}

export async function recoverExpired() {
  const events = await WebhookEvent.find({ state: 'processing', processingUntil: { $lte: new Date() } }).limit(50).lean();
  for (const event of events) {
    try { await ingest(event.payload); } catch (error) { console.error('webhook recovery failed', event.eventId, error); }
  }
}
