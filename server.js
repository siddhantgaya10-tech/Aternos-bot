import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import mineflayer from 'mineflayer';
import { setup } from './commands.js';
import { aiReady, aiModel, setKey, keyHint, ask } from './ai.js';
import { fromSchematic, fromImages } from './build.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const USER = process.env.ADMIN_USER || 'siddhantgaya10@gmail.com';
const PASS = process.env.ADMIN_PASSWORD || 'Siddhant@6198';
if (!PASS) { console.error('Set the ADMIN_PASSWORD environment variable.'); process.exit(1); }
const MAX_BOTS = +process.env.MAX_BOTS || 5;
const DATA_DIR = process.env.DATA_DIR || path.join(dir, 'data');
const DB = path.join(DATA_DIR, 'bots.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
const SET = path.join(DATA_DIR, 'settings.json');
try { const k = JSON.parse(fs.readFileSync(SET, 'utf8')).geminiKey; if (k) setKey(k); } catch {}

const TOKEN = crypto.createHmac('sha256', process.env.SECRET || 'afk-' + USER + PASS).update('admin').digest('hex');
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };

let configs = []; try { configs = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
const save = () => fs.writeFileSync(DB, JSON.stringify(configs, null, 2));
const clients = new Set();
const broadcast = o => { const s = JSON.stringify(o); for (const c of clients) if (c.readyState === 1) c.send(s); };
const runners = new Map();

class Runner {
  constructor(cfg) { this.cfg = cfg; this.status = 'offline'; this.logs = []; this.tries = 0; this.since = null; this.bot = null; }
  view() { return { ...this.cfg, status: this.status, since: this.since, tries: this.tries, logs: this.logs.slice(-40) }; }
  push() { broadcast({ type: 'bot', bot: this.view() }); }
  set(s) { this.status = s; this.push(); }
  log(m) { const line = { t: Date.now(), m: String(m).slice(0, 300) }; this.logs.push(line); if (this.logs.length > 150) this.logs.shift(); broadcast({ type: 'log', id: this.cfg.id, line }); }
  start() { clearTimeout(this.rt); this.cfg.enabled = true; save(); if (!this.bot) this.connect(); }
  stop() {
    clearTimeout(this.rt); this.cfg.enabled = false; save();
    if (this.bot) { try { this.bot.quit(); } catch {} } else this.set('offline');
  }
  connect() {
    const { host, port, username, version } = this.cfg;
    this.set('connecting'); this.log(`Connecting to ${host}:${port} as ${username}`);
    let bot;
    try { bot = mineflayer.createBot({ host, port, username, version: version || undefined, auth: 'offline', hideErrors: true, checkTimeoutInterval: 120000 }); }
    catch (e) { this.log('Could not start: ' + e.message); return this.retry(); }
    this.bot = bot; setup(bot, this);
    bot.once('spawn', () => { this.tries = 0; this.since = Date.now(); this.set('online'); this.log('Joined the server (Minecraft ' + bot.version + ')'); bot.waitForChunksToLoad().then(() => this.afk()).catch(() => this.afk()); });
    bot.on('messagestr', m => { if (m.trim()) this.log('chat: ' + m); });
    bot.on('kicked', r => this.log('Kicked: ' + (typeof r === 'string' ? r : JSON.stringify(r))));
    bot.on('error', e => this.log('Error: ' + e.message));
    bot.on('end', r => {
      clearTimeout(this.at); this.bot = null; this.busy = false; this.since = null; this.log('Disconnected (' + r + ')');
      this.cfg.enabled ? this.retry() : this.set('offline');
    });
  }
  retry() {
    this.tries++;
    const ms = Math.min(120000, 5000 * 2 ** Math.min(this.tries, 5));
    this.set('reconnecting'); this.log(`Reconnecting in ${Math.round(ms / 1000)}s (attempt ${this.tries})`);
    this.rt = setTimeout(() => this.connect(), ms);
  }
  afk() {
    const tick = () => {
      const b = this.bot; if (!b) return;
      if (!this.busy) try { b.swingArm(); } catch {}
      this.at = setTimeout(tick, 15000 + Math.random() * 25000);
    };
    this.at = setTimeout(tick, 5000);
  }
}

const add = cfg => { const r = new Runner(cfg); runners.set(cfg.id, r); return r; };
configs.forEach(c => { const r = add(c); if (c.enabled) r.connect(); });

const app = express();
app.get('/health', (_, res) => res.json({ ok: true, bots: runners.size }));

const fails = new Map();
app.post('/api/login', express.json({ limit: '2kb' }), (req, res) => {
  const ip = req.ip, f = fails.get(ip) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 600000) return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
  if (!(safeEq(String(req.body?.username ?? '').toLowerCase(), USER.toLowerCase()) & safeEq(req.body?.password ?? '', PASS))) { fails.set(ip, { n: f.n + 1, t: Date.now() }); return res.status(401).json({ error: 'Wrong username or password.' }); }
  fails.delete(ip); res.json({ token: TOKEN });
});

const auth = (req, res, next) => safeEq((req.headers.authorization || '').replace('Bearer ', ''), TOKEN) ? next() : res.status(401).json({ error: 'Unauthorized' });
const api = express.Router(); api.use(auth); api.use(express.json({ limit: '12mb' }));
const get = (req, res) => { const r = runners.get(req.params.id); if (!r) res.status(404).json({ error: 'Bot not found' }); return r; };

const keyState = () => ({ hasKey: aiReady(), hint: keyHint() });
api.get('/settings', (_, res) => res.json(keyState()));
api.post('/settings', async (req, res) => {
  const k = String(req.body?.geminiKey || '').trim();
  if (!k) { setKey(process.env.GEMINI_API_KEY || ''); try { fs.unlinkSync(SET); } catch {} return res.json(keyState()); }
  if (!/^[^\s"'<>]{20,400}$/.test(k)) return res.status(400).json({ error: 'The key has spaces or is too short. Copy only the key itself.' });
  try { await ask([{ role: 'user', parts: [{ text: 'Say OK' }] }], 'Reply with OK.', { key: k }); } catch (e) { return res.status(400).json({ error: 'Key rejected: ' + e.message }); }
  setKey(k); fs.writeFileSync(SET, JSON.stringify({ geminiKey: k }), { mode: 0o600 }); res.json(keyState());
});
api.post('/bots/:id/ai', (req, res) => {
  const r = get(req, res); if (!r) return;
  if (!aiReady()) return res.status(400).json({ error: 'Add your Gemini API key first.' });
  if (!r.bot || r.status !== 'online' || !r.aiChat) return res.status(400).json({ error: 'Bot is not online.' });
  const m = String(req.body?.message || '').slice(0, 1000); r.log('you → AI: ' + m); r.aiChat(m); res.json({ ok: true });
});
api.post('/bots/:id/build', async (req, res) => {
  const r = get(req, res); if (!r) return;
  if (!r.bot || r.status !== 'online' || !r.build) return res.status(400).json({ error: 'Bot is not online.' });
  const { kind, data, text, mode, mime } = req.body || {};
  try {
    const buf = Buffer.from(String(data || ''), 'base64'); if (!buf.length) throw new Error('No file received.');
    let blocks;
    if (kind === 'schematic') blocks = await fromSchematic(buf, r.bot.version);
    else { if (!aiReady()) throw new Error('Add your Gemini API key first.'); r.log('Asking Gemini to read the picture…'); blocks = await fromImages([{ mimeType: mime || 'image/jpeg', data }], String(text || '').slice(0, 500), r.bot.registry); }
    const p = r.bot.entity.position, n = v => (v !== '' && v != null && Number.isFinite(+v) ? Math.floor(+v) : null);
    const o = { x: n(req.body.x) ?? Math.floor(p.x) + 3, y: n(req.body.y) ?? Math.floor(p.y), z: n(req.body.z) ?? Math.floor(p.z) };
    r.build(blocks, o, mode === 'survival' ? 'survival' : 'op'); res.json({ ok: true, blocks: blocks.length });
  } catch (e) { r.log('Build failed: ' + e.message); res.status(400).json({ error: e.message }); }
});
api.get('/bots', (_, res) => res.json([...runners.values()].map(r => r.view())));
api.post('/bots', (req, res) => {
  const { host, port, username, version, owner } = req.body || {};
  if (runners.size >= MAX_BOTS) return res.status(400).json({ error: `Limit of ${MAX_BOTS} bots reached.` });
  if (!/^[\w.-]{3,100}$/.test(host || '')) return res.status(400).json({ error: 'Enter a valid server address, e.g. myserver.aternos.me' });
  const p = +port || 25565; if (p < 1 || p > 65535) return res.status(400).json({ error: 'Port must be 1–65535.' });
  if (!/^\w{3,16}$/.test(username || '')) return res.status(400).json({ error: 'Username must be 3–16 letters, numbers or underscores.' });
  if (version && !/^\d+\.\d+(\.\d+)?$/.test(version)) return res.status(400).json({ error: 'Version looks like 1.20.4, or leave it empty.' });
  if (owner && !/^\w{3,16}$/.test(owner)) return res.status(400).json({ error: 'Owner must be a valid Minecraft username.' });
  const cfg = { owner: owner || '', id: crypto.randomUUID(), host, port: p, username, version: version || '', enabled: true, created: Date.now() };
  configs.push(cfg); save(); const r = add(cfg); r.connect(); res.json(r.view());
});
api.patch('/bots/:id', (req, res) => {
  const r = get(req, res); if (!r) return; const o = String(req.body?.owner || '');
  if (o && !/^\w{3,16}$/.test(o)) return res.status(400).json({ error: 'Owner must be a valid Minecraft username.' });
  r.cfg.owner = o; save(); r.push(); r.log(o ? 'Owner set to ' + o : 'Owner cleared'); res.json(r.view());
});
api.post('/bots/:id/start', (req, res) => { const r = get(req, res); if (r) { r.start(); res.json(r.view()); } });
api.post('/bots/:id/stop', (req, res) => { const r = get(req, res); if (r) { r.stop(); res.json(r.view()); } });
api.post('/bots/:id/chat', (req, res) => {
  const r = get(req, res); if (!r) return;
  const m = String(req.body?.message || '').slice(0, 250);
  if (!r.bot || r.status !== 'online') return res.status(400).json({ error: 'Bot is not online.' });
  if (m.startsWith('!') && r.runCommand) { r.log('you (command): ' + m); r.runCommand(m); return res.json({ ok: true }); }
  r.bot.chat(m); r.log('you: ' + m); res.json({ ok: true });
});
api.delete('/bots/:id', (req, res) => {
  const r = get(req, res); if (!r) return;
  r.stop(); runners.delete(r.cfg.id); configs = configs.filter(c => c.id !== r.cfg.id); save();
  broadcast({ type: 'removed', id: r.cfg.id }); res.json({ ok: true });
});
app.use('/api', api);
app.use(express.static(path.join(dir, 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const t = new URL(req.url, 'http://x').searchParams.get('token');
  if (!safeEq(t || '', TOKEN)) return ws.close(4001);
  clients.add(ws); ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify({ type: 'init', bots: [...runners.values()].map(r => r.view()) }));
});
setInterval(() => { for (const c of clients) if (c.readyState === 1) c.ping(); }, 30000);

const down = () => { runners.forEach(r => { r.bot && r.bot.quit(); }); setTimeout(() => process.exit(0), 500); };
process.on('SIGTERM', down); process.on('SIGINT', down);
process.on('uncaughtException', e => console.error('uncaught', e.message));
process.on('unhandledRejection', e => console.error('unhandled', e?.message || e));
server.listen(PORT, () => console.log('AFK bot dashboard on :' + PORT + ' | Gemini AI: ' + (aiReady() ? 'on (' + aiModel + ')' : 'off, add a key in the dashboard')));
