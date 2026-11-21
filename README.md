# Stayput – 24/7 Aternos AFK bot dashboard

Real Minecraft bots (mineflayer) controlled from a web dashboard. They join your server, move around to avoid AFK kicks, auto-reconnect with backoff, and survive restarts (bots saved in `DATA_DIR/bots.json`).

## Run locally
    npm install
    ADMIN_PASSWORD=yourpass npm start      # http://localhost:3000

## Deploy 24/7
It must run on an always-on host (a free-tier site that sleeps will stop the bots).
- **VPS / Oracle free tier / Raspberry Pi:** `npm install && ADMIN_PASSWORD=... pm2 start server.js`
- **Docker (Railway, Fly.io, Koyeb, etc.):** use the Dockerfile, set `ADMIN_PASSWORD`, mount a volume at `/data`.
- Render free tier sleeps after 15 min idle: ping `/health` every 5 min with UptimeRobot, and note its disk resets without a paid disk.

Env: `ADMIN_USER` (default `Admin`), `ADMIN_PASSWORD` (required), `SECRET`, `PORT`, `MAX_BOTS` (default 5), `DATA_DIR`.

## Notes
- Aternos won't start from the bot. Press Start in the Aternos panel. The bot retries until the server is up.
- Turn whitelist off, or whitelist the bot username (offline-mode/cracked join is used).
- Aternos' terms discourage AFK bots, so use at your own risk.
