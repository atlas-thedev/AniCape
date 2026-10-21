# Native Cape Contest — existing-bot API

No new Discord bot is needed. The site stores validated entry files and exposes an authenticated queue. The **existing Native bot** supplies verified user identity, posts both attachments, seeds 👍, counts human votes, and sends the final snapshot. This project does not contain a Discord bot token or a Discord API client.

## Configuration

On the VPS, `/etc/native-cape-contest.env` (root-readable only) contains:

```
PORT=3426
SITE_ORIGIN=https://YOUR-CONFIRMED-HOST
DATA_DIR=/var/lib/native-cape-contest
BOT_API_KEY=<generated-256-bit-server-secret>
```

The bot developer must copy BOT_API_KEY into the existing bot's private environment as `CAPE_API_KEY`; set `CAPE_API_BASE` to the site's HTTPS origin. Never expose the key to browser code, public GitHub, chat, or a slash-command response. On the same VPS the bot may call `http://127.0.0.1:3426` instead of the public hostname. Keep the existing Discord token in the existing bot config.

All `/api/bot/*` endpoints require `Authorization: Bearer <CAPE_API_KEY>`. JSON requests use `Content-Type: application/json`. Errors return `{ "error": "..." }` with appropriate HTTP status. No permissive CORS is enabled.

## 1. Give a verified Discord user a personal editor link

Inside the existing bot's `/cape` command, use **interaction.user.id**, never a user-supplied ID:

```js
const base = process.env.CAPE_API_BASE;
async function capeAPI(route, body) {
  const r = await fetch(`${base}/api/bot${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${process.env.CAPE_API_KEY}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${data.error}`);
  return data;
}
const ticket = await capeAPI('/tickets', {
  discord_user_id: interaction.user.id
});
// Respond EPHEMERALLY: this link signs in as this Discord user.
await interaction.reply({content: `Create your entry: ${ticket.entry_url}`, ephemeral: true});
```

Response `201`: `{ "entry_url": "https://HOST/#entry_ticket=...", "expires_in": 600 }`.

The one-use link expires in 10 minutes. The site exchanges the fragment token for a 24-hour HttpOnly, Secure, SameSite=Strict session; the token is removed from browser history. User files remain local until Submit is clicked. The browser cannot invent a Discord identity.

## 2. Poll pending entries

`GET /api/bot/entries?status=pending`

```json
{"entries":[{"entry_id":"UUID","entry_name":"My cape","discord_user_id":"123456789012345678","frames":2,"fps":10,"width":128,"frameHeight":64,"status":"pending","nonce":"24-character-stable-nonce","files":{"cape_texture":"/api/bot/entries/UUID/files/texture","preview_gif":"/api/bot/entries/UUID/files/preview"},"message_id":null,"message_url":null}]}
```

At most 100 per response. For every status (`pending`, `processing`, `submitted`, `failed`), pass `&after=<last-entry-id>` to fetch the next page. Poll every 5–10 seconds and back off on errors. Do not create overlapping worker loops.

## 3. Claim before posting

`POST /api/bot/entries/{entry_id}/claim` with `{}`.

Exactly one worker gets success. A second claim gets `409`. Claimed entries stay `processing` across restarts; they do **not** automatically return to pending, to avoid duplicate Discord posts.

Fetch both attachment paths with the same Bearer key. `cape_texture` is a PNG (`cape.png` for static, `cape-strip.png` for animation); `preview_gif` is `model-preview.gif`. Each is limited to 8 MiB. Keep the original texture dimensions and animation frame order. The server validates signatures/dimensions, PNG chunk CRCs, and GIF decoding. It does not certify artwork originality or independently prove an uploaded GIF was rendered in 3D.

## 4. Post into the configured contest channel using the existing bot

Use Discord API v10 Create Message, or the existing bot library's equivalent. Send **one message containing both files**, not separate messages. Disable all parsed mentions. Include entry ID, frame count/FPS and author ID in the text/embed. Escape the user-provided entry name appropriately.

REST multipart payload example:

```js
const form = new FormData();
form.set('payload_json', JSON.stringify({
  content: `Native Cape Contest · Entry ${entry.entry_id}\n${entry.entry_name}\nAuthor: ${entry.discord_user_id}\n${entry.frames} frame(s) · ${entry.fps} FPS\nVote with 👍`,
  allowed_mentions: {parse: []},
  nonce: entry.nonce,
  enforce_nonce: true,
  attachments: [
    {id: 0, filename: entry.frames > 1 ? 'cape-strip.png' : 'cape.png'},
    {id: 1, filename: 'model-preview.gif'}
  ]
}));
form.set('files[0]', new Blob([textureBytes], {type:'image/png'}),
  entry.frames > 1 ? 'cape-strip.png' : 'cape.png');
form.set('files[1]', new Blob([gifBytes], {type:'image/gif'}), 'model-preview.gif');
// Existing bot token only. Do not manually set multipart Content-Type.
const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
  method:'POST', headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`}, body:form
});
```

The bot needs View Channel, Send Messages, Attach Files, Read Message History and Add Reactions. Respect Discord 429 retry_after and permission/file-size errors. The existing bot developer must configure the actual contest channel ID; the website never accepts an arbitrary channel from a visitor.

After a successful Create Message response, save its ID durably in the bot DB **before** other actions, then add 👍. A reaction-seeding failure must not repost the entry.

## 5. Confirm the actual Discord message

`POST /api/bot/entries/{entry_id}/complete`

```json
{"message_id":"123456789012345678","channel_id":"234567890123456789","guild_id":"345678901234567890"}
```

Only call after Discord confirms the actual message. Repeating completion with the same message ID is safe. A different ID for an already-completed entry returns `409`. The website changes from “Queued / posting” to “Submitted” **only after this callback**, and displays the message link. The site trusts this authenticated bot callback; it does not independently fetch Discord.

### Recovery / duplicate protection

- Browser retry uses Idempotency-Key; the same user/key/content returns the same entry. Changed content with the same key returns `409`.
- Bot startup: reconcile `status=processing` with its durable message-ID mapping and the entry ID marker in the Discord channel. Complete existing posts instead of posting again.
- Use the supplied stable nonce + enforce_nonce for Discord's short-term duplicate protection. This is not a permanent exactly-once guarantee.
- If a request times out after sending to Discord, **do not blindly repost**. Reconcile first.
- Only after confirming no Discord post exists: `POST /api/bot/entries/{id}/retry` with `{"confirm_no_discord_post":true}`. This returns it to pending. Requires the server key and an open event.

## 6. Admin-only close, voting and results

Expose these only through the existing bot's admin-authorized commands. Check a real admin permission/approved role, not a command argument or browser ID.

`GET /api/bot/event` → `{ "open": true, "results": null, "total": 0 }`.

`POST /api/bot/event` with `{"action":"close"}` stops new submissions/claims and expires pending queue entries. Reconcile any in-flight `processing` posts before finalization. Existing Discord reactions can continue, but must not alter an already-frozen result.

The bot then fetches **all** users for 👍 reactions on every submitted entry, paginating 100 at a time. If normal and burst/Super reactions are both included, union user IDs across both; count each human once, exclude `user.bot` including the seeded bot reaction. Other emoji do not count. Do not arbitrarily discard self-votes. Record the collection time and explain this is the closing snapshot, not an exact historical reconstruction at an earlier timestamp.

Submit the complete final snapshot:

```http
POST /api/bot/event
```
```json
{"action":"results","votes":[{"entry_id":"UUID","votes":42}]}
```

Include every submitted entry exactly once. Results cannot be saved while processing entries remain or the event is open. The API records max votes and all tied entry IDs; no votes means no automatic winner. It refuses a second results snapshot. **Vote counts are computed by the existing bot, not by this website.** Keep the per-user evidence in the bot DB for audit.

`{"action":"open"}` explicitly reopens submissions and clears the saved results; use only for an intentional new/reopened round, never as an automatic retry.

## VPS control

```bash
sudo native-cape-contest stop
sudo native-cape-contest status
# Intentional reopen; clears saved final results:
sudo native-cape-contest start
```

`stop` immediately closes submissions and the public editor landing page. It does NOT fetch Discord votes or stop the existing bot/main website. Final vote collection is performed by the existing bot's admin close command and sent to the results endpoint.

## Browser API (already wired; bot should not call these)

- POST `/api/session`: one-use ticket exchange, exact Origin required.
- GET `/api/session`: current verified identity, cookie required.
- POST `/api/entries`: authenticated multipart upload, exact Origin + Idempotency-Key required. Fields: entry_name, frame_count, fps, width, frame_height, cape_texture, preview_gif.
- GET `/api/entries/{id}`: own entry status only.
- GET `/api/event`: open/closed state and frozen results.

Technical upload rate limit: five new entries per verified user per hour. This is an abuse limit, not an announced contest entry rule. Discord itself may impose stricter file/rate limits.
