# Mirrorline web

React + Vite dashboard for the Rails trade copier (`trade_copier_api`). It reads one snapshot (`GET /api/v1/dashboard`, polled every 3 s) and sends changes through the other endpoints.

## Run it

1. Install packages: `npm install`
2. Start the Rails API on port 3000 (and the simulator if you have no MetaTrader): see the API's README.
3. Start the dashboard: `npm run dev`
4. Open http://localhost:5173 and sign in with the seeded login (`admin@example.com` / `change-me-please`).

`.env` ships with `VITE_LIVE=true`. Remove that line to explore the app with built-in demo data and no backend.
In dev, Vite proxies `/api` to `http://127.0.0.1:3000` (override with `API_TARGET=...`).

## Pages

| Page | What it does | API |
|---|---|---|
| Overview | Combined equity, summary, the mirror board (master trades on the left, each follower's copy on the right) | `GET /dashboard` |
| Trades | Open positions, close one or all, new trade to any accounts | `/positions/*`, `/orders` |
| Accounts | Connect, edit, pause, kill switch, new EA token, remove | `/trading_accounts*` |
| Copy links | Lot mode, reverse, slippage, suffix, symbol filter, pending orders, catch-up | `/copy_links*` |
| Risk | Five per-follower limits pushed to the EA | `PUT /trading_accounts/:id/guards` |
| Activity | Every order sent to an account and its result (failed, expired, skipped) | `GET /audit/commands` |

The top bar switch is the global copier pause (`PUT /copier`).

## Production

Set `VITE_API_URL` to the API origin (no trailing slash), run `npm run build`, serve `dist/`, and make the host return `index.html` for unknown paths. Add the dashboard origin to `DASHBOARD_ORIGINS` on the API (CORS).

## Contract test

Runs `src/lib/api.js` against a live, seeded backend (it creates and deletes its own temporary account):

```bash
EMAIL=admin@example.com PASSWORD=change-me-please npm run test:contract
```
