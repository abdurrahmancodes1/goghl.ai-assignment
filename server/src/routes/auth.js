import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { Session } from '../models.js';
const router = Router();
const encode = (x) => Buffer.from(x).toString('base64url');
const cookie = (id) => `sb_session=${id}; HttpOnly; SameSite=Lax; Path=/`;
router.get('/login', async (_req, res, next) => {
  try {
    const id = encode(crypto.randomBytes(18)); const state = encode(crypto.randomBytes(18)); const verifier = encode(crypto.randomBytes(32));
    await Session.create({ _id: id, sub: '', workspaces: [], pkce: { state, verifier }, expiresAt: new Date(Date.now() + 600000) });
    const url = new URL(config.oidc.issuer + '/authorize');
    url.search = new URLSearchParams({ client_id: config.oidc.client, redirect_uri: config.oidc.redirect, response_type: 'code', scope: 'openid profile email', state, nonce: state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    res.setHeader('Set-Cookie', cookie(id)); res.redirect(url.toString());
  } catch (e) { next(e); }
});
router.get('/callback', async (req, res, next) => {
  try {
    const id = req.headers.cookie?.match(/sb_session=([^;]+)/)?.[1]; const session = id && await Session.findById(id); if (!id || !session || !req.query.code || req.query.state !== session.pkce?.state) return res.status(400).end();
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: config.oidc.redirect, client_id: config.oidc.client, client_secret: config.oidc.secret, code_verifier: session.pkce.verifier });
    const tokenResponse = await fetch(config.oidc.issuer + '/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(config.timeouts.oidc) }); if (!tokenResponse.ok) return res.status(401).end();
    const token = await tokenResponse.json(); const info = await fetch(config.oidc.issuer + '/userinfo', { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(config.timeouts.oidc) }); if (!info.ok) return res.status(401).end(); const u = await info.json();
    await Session.updateOne({ _id: id }, { $set: { sub: u.sub, name: u.name, email: u.email, workspaces: u.workspaces }, $unset: { pkce: 1 } }); res.setHeader('Set-Cookie', cookie(id)); res.redirect(config.origin);
  } catch (e) { next(e); }
});
export default router;
