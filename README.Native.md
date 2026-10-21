# Native Community Cape Contest

Adapted from [AniCape by Terry010011](https://github.com/Terry010011/AniCape), MIT; original LICENSE and library credits retained. Native branding, real skinview3d WebGL player GIF export (320×320, moving 3D model), animated vertical PNG strip + first-frame PNG + metadata ZIP, and existing-bot secure API queue.

## Run / test

Node 22+, no npm install or build needed. Vendored upstream libraries are retained.

```sh
node --test test/*.test.mjs
SITE_ORIGIN=http://127.0.0.1:3495 BOT_API_KEY=local-test-only PORT=3495 DATA_DIR=/tmp/native-contest node server/server.mjs
```

Production: install the systemd unit under deploy/, create native-contest system user and private writable data directory, set root-only /etc/native-cape-contest.env, proxy the confirmed HTTPS hostname to 127.0.0.1:3426. No public endpoint should be enabled before HTTPS and the correct SITE_ORIGIN are configured. Do not expose server/, test/, data or environment files as static assets.

See [API.md](API.md) for the complete API, existing-bot integration, verification, vote rules, failure recovery and stop command. No new bot is included; an existing-bot developer must connect the queue and Discord callbacks. Website success is not shown until the bot confirms a Discord message ID.

Save Project preserves editable artwork. Export works without Discord login; submission requires a personal link issued by the existing bot. Nothing is uploaded until Submit is clicked. No service-worker offline cache; closure is checked periodically. No deadline/prize is invented.
