# HTML Present — self-hosted

[Tiếng Việt](README.vi.md)

HTML Present serves static HTML presentations and provides a single-admin library for managing them. The self-hosted edition stores its configuration, uploads, and logs on the local filesystem.

## Requirements

- Node.js 20 or newer and npm, or Docker with Docker Compose.
- A writable data directory with enough space for uploaded presentations.

## Run with Node.js

```sh
npm install
DATA_DIR="$HOME/.html-present" PORT=3301 npm start
```

Open `http://127.0.0.1:3301/_admin` and create the administrator password on first use. The default data directory is `~/.html-present`; set `DATA_DIR` to choose another location. Keep that directory outside the source checkout and back it up.

For a local check, use a non-production port, for example `DATA_DIR=/tmp/html-present-data PORT=3302 npm start`. The `.env.example` file is used by Docker Compose; npm does not load it automatically.

## Run with Docker Compose

```sh
cp .env.example .env
docker compose up -d --build
```

The container listens on port 3301 and Compose publishes it on port 3302 by default. Set `PORT` in `.env` to change the host port. The named volume `html-present-data` stores all persistent application data.

For HTTPS behind a trusted reverse proxy, set `COOKIE_SECURE=1`. Only configure `CLIENT_IP_HEADER` or `COUNTRY_HEADER` when the application can be reached exclusively through a proxy that overwrites those headers. Do not trust headers supplied directly by public clients.

## Move existing data

Set the old data directory as `--source` and the new `DATA_DIR` as `--target`. Review the dry-run first; the script copies files and never deletes the source.

```sh
node scripts/migrate-data-dir.js --source /path/to/old-data --target /path/to/new-data
node scripts/migrate-data-dir.js --source /path/to/old-data --target /path/to/new-data --apply
```

Back up both directories before switching the running service. Point `DATA_DIR` at the new location only after the copy reports matching SHA-256 hashes. To roll back, stop the service and point `DATA_DIR` at the old directory.

## Security notes

Only upload HTML and JavaScript that you trust. Uploaded HTML runs in visitors' browsers with the origin's permissions. For stronger separation, serve presentations from a different origin than the admin interface and use HTTPS. See [SECURITY.md](SECURITY.md).

The first-run setup requires a strong administrator password. The admin uses CSRF protection, persistent file sessions, and login throttling. Treat the data directory as private: it contains session files, access logs, and your presentation content.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3301` | Listening port |
| `HOST` | `127.0.0.1` | Listening interface |
| `DATA_DIR` | `~/.html-present` | Persistent application data |
| `COOKIE_SECURE` | `0` | Set to `1` when HTTPS is terminated by a trusted proxy |
| `TZ` | `Asia/Ho_Chi_Minh` | Timezone for displayed timestamps |
| `CLIENT_IP_HEADER` | unset | Proxy header used for client IP, only behind a trusted proxy |
| `COUNTRY_HEADER` | unset | Proxy header used for country code |
| `PROXY_PROFILE` | `none` | Set to `cloudflare` only when traffic comes through Cloudflare; fills in its client IP and country headers |

Brand name, logo, primary color, and footer visibility can be changed from **Cài đặt → Thương hiệu** in the admin.

## Backup

Stop the application or take a filesystem-consistent snapshot, then back up the complete `DATA_DIR`. Test restoration by starting a separate instance with a copied data directory and a non-production port.
