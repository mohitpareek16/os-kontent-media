# Deployment guide — fresh VPS, private repo, Nginx + HTTPS + auto-deploy

Follow this doc end-to-end to take this repo from "code on my laptop" to
"running in production on a fresh server, behind Nginx with a real SSL
certificate, redeploying itself on every push to `master`." It's written so
a Claude Code instance running **on the target server** can execute Sections
4 onward directly — hand it this file and say "read
`docs/10-deployment-guide.md` and run Sections 4 onward for domain
`<DOMAIN>`."

**If any of `<DOMAIN>`, `<REPO_URL>`, the owner's name/email, or a Postgres/
JWT secret aren't already known, ask the user first — don't invent or guess
secrets, and don't pick a domain on your own.**

Assumes a fresh Ubuntu 22.04/24.04 VPS with root or sudo SSH access, and that
the repo lives in a **private** GitHub/GitLab repo (this is a client
project — see Section 3 for why we use a scoped deploy key here instead of
a personal token).

The production-specific config (`docker-compose.prod.yml`,
`frontend/nginx.prod.conf`, `deploy/deploy.sh`, `.github/workflows/deploy.yml`)
is already committed in this repo — you're not authoring it by hand on the
server. The only server-specific edit is dropping the real domain into
`frontend/nginx.prod.conf` once (Section 7).

---

## 1. Push the local repo to a git remote

`.env` is already gitignored (see `.gitignore`) so no secrets get pushed.
Double check before the first push:

```bash
git status                          # should be clean
cat .gitignore | grep -E '\.env$'   # confirms .env is ignored
```

Create a **private** repo on GitHub/GitLab, then:

```bash
git remote add origin <REPO_URL>
git push -u origin master
```

## 2. Base server setup

SSH in as root (or a sudo user) and do the boring-but-important stuff first:

> **Note on the current server:** the live box (`ops.kontentmedia.in`) was
> set up without this step — the app lives at `/root/Kontent-Media` and the
> deploy key sits in `/root/.ssh/authorized_keys`, so `SSH_USER` is `root`,
> not `deploy`. The forced command still confines that key to `deploy.sh`.
> Creating the `deploy` user below is the better practice for a fresh
> server; if you do it, move the checkout and update `SSH_USER` to match.

```bash
adduser deploy                  # non-root user to work as
usermod -aG sudo deploy
su - deploy

sudo apt update && sudo apt upgrade -y
sudo apt install -y ufw curl git

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable                 # confirm yes
sudo ufw status
```

From here on, stay logged in as `deploy`, not root.

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker                   # or log out/in
docker compose version          # sanity check
```

## 4. Clone the private repo

Since this is a **client's server**, don't put a personal SSH key or a
broad-scope personal access token on it. Use a **deploy key**: an SSH
keypair generated on this server, added to the repo as a **read-only** key.
If this key ever leaks, the blast radius is "read access to this one repo,"
not "access to everything in the account." (This is a separate keypair from
the one in Section 9 — that one lets GitHub *push into* this server; this
one only lets this server *pull from* GitHub.)

```bash
ssh-keygen -t ed25519 -C "kontent-media-deploy" -f ~/.ssh/kontent_deploy -N ""
cat ~/.ssh/kontent_deploy.pub
```

Copy that public key and add it in the repo's settings:
- **GitHub:** repo → Settings → Deploy keys → Add deploy key → paste it,
  leave "Allow write access" **unchecked**.
- **GitLab:** repo → Settings → Repository → Deploy keys → Add key
  (read-only is the default).

Then point SSH at that key for this host and clone over SSH:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/kontent_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

git clone git@github.com:<org>/<repo>.git kontent-media
cd kontent-media
```

(Swap the URL for GitLab's `git@gitlab.com:...` form if that's where it
lives — same deploy-key mechanism.)

## 5. Install Claude Code on the server

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude --version
```

Run `claude` in the repo directory and authenticate (`/login`, or set
`ANTHROPIC_API_KEY` in the environment if this server should run
non-interactively). Once it's in, give it this file:

> Read `docs/10-deployment-guide.md` in this repo and execute Section 6
> onward for domain `<DOMAIN>`. Ask me for anything you don't already have
> (owner name/email/password, confirmation before anything destructive).

Everything below is written for that agent (or you, doing it by hand) to
follow directly.

## 6. Configure environment and bring the stack up over HTTP

```bash
cp .env.example .env
```

Edit `.env`:
- `JWT_SECRET` — replace with a real random value: `openssl rand -hex 32`
- `CORS_ORIGINS` — set to the real domain over HTTPS:
  `["https://<DOMAIN>"]`
- `DATABASE_URL` / `UPLOADS_DIR` — leave as-is, they point at the `db`
  container and the mounted volume respectively.
- `OPENROUTER_API_KEY` — **leave empty unless an OpenRouter account exists.**
  Kontent Bot then reports itself as not connected instead of failing; there
  is nothing to fix. Filling it in is the entire activation step — see
  [Kontent Bot](11-ai-chatbot.md). It is a spending key: `AI_DAILY_MESSAGE_CAP`
  bounds per-user usage, and the model behind `OPENROUTER_MODEL` sets the rate.

Never commit this file — confirm `git status` doesn't show `.env`.

`docker-compose.yml` as checked in is already production-safe by default:
Postgres and the API are bound to `127.0.0.1` only (Nginx reaches `app`
over the internal Docker network, so it never needs the public port), and
all three services restart automatically on reboot/crash. Bring the stack
up and verify over plain HTTP before touching TLS:

```bash
docker compose up -d --build
docker compose ps                          # all three should be "Up"
docker compose exec app alembic upgrade head
docker compose exec app python -m scripts.create_owner "<Owner Name>" <owner@email> "<strong-password>"
curl -i http://<DOMAIN>/api/health
```

Visiting `http://<DOMAIN>` in a browser should show the login page.

## 7. Point DNS and get a real certificate

Before this step, make sure `<DOMAIN>`'s **A record** points at this
server's public IP (check with `dig <DOMAIN> +short`) — Let's Encrypt's
HTTP challenge will fail otherwise.

Install certbot on the **host** (not in a container — this keeps the
renewal timer simple and standard):

```bash
sudo apt install -y certbot
```

The `web` container already serves `/.well-known/acme-challenge/` from
`deploy/certbot-webroot/` (baked into `frontend/nginx.conf` and mounted in
`docker-compose.yml`), so the stack from Section 6 can answer the challenge
as-is:

```bash
sudo certbot certonly --webroot \
  -w ~/kontent-media/deploy/certbot-webroot \
  -d <DOMAIN> \
  --email <owner@email> --agree-tos --no-eff-email
```

Once that succeeds, `/etc/letsencrypt/live/<DOMAIN>/` exists on the host.
Now do the one server-specific edit this repo needs: open
`frontend/nginx.prod.conf` and replace every `<DOMAIN>` with the real
domain, then commit and push it (from your laptop, or directly here if
this is the only place the change is made — either way it needs to land on
`master` so future auto-deploys don't clobber it):

```bash
git add frontend/nginx.prod.conf
git commit -m "deploy: set production domain"
git push origin master
```

Then bring the stack up with the production overlay, which adds port 443
and swaps in the TLS-enabled Nginx config:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl -i https://<DOMAIN>/api/health
```

`http://<DOMAIN>` should now redirect to `https://<DOMAIN>`. From this
point on, **always** bring the stack up with both `-f` flags (the deploy
script in Section 9 already does this).

## 8. Auto-renew the certificate

`apt install certbot` already installs a systemd timer that runs `certbot
renew` twice daily — it's a no-op until the cert is within 30 days of
expiry. The only gap: Nginx needs to reload after a renewal to pick up the
new cert. Add a deploy hook:

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh > /dev/null <<'EOF'
#!/bin/sh
docker compose -f /home/deploy/kontent-media/docker-compose.yml -f /home/deploy/kontent-media/docker-compose.prod.yml exec web nginx -s reload
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

sudo certbot renew --dry-run       # should complete with no errors
```

## 9. Set up auto-deploy (push to `master` → live on the server)

`.github/workflows/deploy.yml` is already in the repo — on every push to
`master` it SSHes into this server and runs `deploy/deploy.sh`, which pulls
`master`, rebuilds changed containers with the prod overlay, and runs
migrations. What's left is wiring the SSH connection, and doing it in a way
that doesn't hand GitHub the run of the house on a client's server.

A separate workflow, `.github/workflows/ci.yml`, runs the backend test suite
and a full frontend `tsc -b` + `vite build` on every pull request and every
push to `master`. It is deliberately not part of the deploy job: deploy stays
a single-purpose script with a forced command behind it, and CI needs no
access to this server at all. If you want a broken build to block a deploy,
add a branch protection rule requiring the CI checks — don't chain the two
workflows together.

**Generate a dedicated, restricted deploy key** (separate from the Section
4 key — that one lets this server *read from* GitHub; this one lets GitHub
*run one script on* this server, nothing else):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/ci_deploy -N ""
```

Add the public key to `authorized_keys` with a **forced command** — no
matter what command the connecting client sends, only `deploy.sh` ever
runs. This means even if the private key leaks from GitHub's side, it's
useless for anything beyond triggering this one script:

```bash
echo "command=\"/root/Kontent-Media/deploy/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $(cat ~/.ssh/ci_deploy.pub)" >> ~/.ssh/authorized_keys
```

Set the secrets with `gh` and pipe the key straight from the file. **Do not
copy-paste the private key by hand** — a dropped trailing newline or a
re-wrapped line produces a key that fails at connect time with the
misleading `Load key: error in libcrypto` / `Permission denied (publickey)`,
which reads like a permissions problem rather than a corrupted secret. This
is what silently broke deploys between 2026-08-04 and 2026-08-06.

```bash
gh secret set SSH_PRIVATE_KEY --repo <owner>/<repo> < ~/.ssh/ci_deploy
printf 'root'          | gh secret set SSH_USER --repo <owner>/<repo>
printf '<server-ip>'   | gh secret set SSH_HOST --repo <owner>/<repo>
printf '22'            | gh secret set SSH_PORT --repo <owner>/<repo>
```

The secrets, if you prefer to add them via **Settings → Secrets and
variables → Actions** in the browser:
- `SSH_HOST` — this server's public IP or hostname
- `SSH_USER` — `root` (the deploy key lives in `/root/.ssh/authorized_keys`;
  there is no separate `deploy` user on this server)
- `SSH_PRIVATE_KEY` — the full private key including the
  `-----BEGIN/END-----` lines and the trailing newline
- `SSH_PORT` — only if not `22`

For the Telegram notifications the workflow sends (see below), also add
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` — the same values `deploy.sh`
reads from the server's `.env`. Without them the deploy still runs; it just
does not announce itself.

Then delete `~/.ssh/ci_deploy` from the server (it's only needed locally
long enough to print it — GitHub holds the copy that matters, and the
server only needs the public half in `authorized_keys`):

```bash
rm ~/.ssh/ci_deploy
```

**Test it:** push any small change to `master` (or trigger the workflow
manually from the Actions tab — `workflow_dispatch` is enabled) and watch
the Actions run. It should SSH in, and the server should pull, rebuild, and
migrate. Check `docker compose ps` on the server afterward to confirm.

From here on, **deploying is just `git push origin master`.**

## 10. Backups

Postgres data and uploads live in named Docker volumes (`pgdata`, `uploads`)
— they survive `docker compose down` but not `docker compose down -v` or
volume deletion, so back them up off-server. A simple daily dump via cron:

```bash
crontab -e
# add:
0 3 * * * cd /home/deploy/kontent-media && docker compose exec -T db pg_dump -U kontent kontent | gzip > /home/deploy/backups/kontent-$(date +\%F).sql.gz
```

Create `/home/deploy/backups` first, and ship those dumps somewhere off the
box (rsync to another host, S3, etc.) — a backup that only lives on the
server it's backing up isn't a backup.

## 11. Verification checklist

- [ ] `docker compose ps` shows `db`, `app`, `web` all `Up`
- [ ] `https://<DOMAIN>` loads the login page; `http://<DOMAIN>` redirects to it
- [ ] `curl -i https://<DOMAIN>/api/health` → `200`
- [ ] Login works with the bootstrapped owner account
- [ ] `sudo ufw status` shows only `22`, `80`, `443` open
- [ ] From **outside** the server: `nc -zv <SERVER_IP> 5432` and `nc -zv <SERVER_IP> 8000` both fail/closed (confirms Postgres and the API aren't publicly reachable)
- [ ] `sudo certbot renew --dry-run` succeeds
- [ ] A cron backup file exists after the next 3am run
- [ ] A test push to `master` triggers a green run in the Actions tab and the change is live on `<DOMAIN>` afterward

## 12. Common issues

- **502 Bad Gateway** — `app` container isn't up, or crashed on a bad
  `DATABASE_URL`/`JWT_SECRET`. Check `docker compose logs app`.
- **CORS errors in the browser console** — `CORS_ORIGINS` in `.env` doesn't
  exactly match the scheme+domain being used (must be `https://<DOMAIN>`,
  not `http://` or a bare domain). Restart `app` after changing `.env`.
- **Certbot challenge fails** — DNS not pointed at this server yet, or port
  80 blocked by `ufw`/a cloud firewall in front of the VPS. Recheck
  `dig <DOMAIN> +short` against the server's actual public IP.
- **`docker compose exec app alembic upgrade head` fails to connect** — `db`
  container not fully up yet; wait a few seconds and retry, or check
  `docker compose logs db`.
- **GitHub Actions run fails at the SSH step** — check `SSH_HOST`/`SSH_USER`/
  `SSH_PORT` secrets are correct, and that the public key is actually in
  `~/.ssh/authorized_keys` on the server with the forced-command prefix
  intact (a stray line break there breaks the restriction syntax).
- **`Load key ".../deploy_key": error in libcrypto` followed by `Permission
  denied (publickey)`** — this is *not* an authorization problem. The
  `SSH_PRIVATE_KEY` secret itself is malformed, so ssh cannot parse it and
  never offers a key at all. Re-set it by piping the file rather than
  pasting: `gh secret set SSH_PRIVATE_KEY < ~/.ssh/ci_deploy`. The workflow
  now runs `ssh-keygen -y` on the key first so this fails with a clear
  message instead of looking like a server-side denial.
- **Deploy fails and no Telegram message arrives at all** — `deploy.sh` sends
  the `[1/4]`..`[4/4]` messages from *on the server*, so any failure before
  the SSH connection lands is invisible to it. The workflow's own "deploy
  triggered" and "deploy FAILED" steps cover that window; if even those are
  silent, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are missing from the repo
  secrets.
- **Deploy runs green but the site doesn't change** — confirm
  `deploy/deploy.sh` is using both `-f docker-compose.yml -f
  docker-compose.prod.yml`; if only the base file is up, Nginx is still
  serving the old plain-HTTP config path, not the prod one.
