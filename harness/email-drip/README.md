# SimplyApply email drip harness (Mac mini)

Sends the opt-in drip to people who confirmed their address via the free resume check.
Nothing here emails anyone who has not confirmed. Copy is templated (`src/services/email-templates.js`).

## Control
- Stop everything now:  `touch ~/.simplyapply-drip/STOP`   (resume: `rm` it)
- Run once now:         `launchctl kickstart gui/$(id -u)/com.simplyapply.email-drip`
- Dry run (sends nothing): `cd ~/simplyapply-drip-harness/repo/harness/email-drip && set -a && . ~/.simplyapply-drip/env && set +a && DRY_RUN=1 node run.js`
- Logs / history:       `~/.simplyapply-drip/logs/`, `~/.simplyapply-drip/runs.jsonl`
- Uninstall:            `launchctl bootout gui/$(id -u)/com.simplyapply.email-drip && rm ~/Library/LaunchAgents/com.simplyapply.email-drip.plist`

## Limits (enforced in run.js)
default 10 emails per run (hard ceiling 25) - 5 runs a day (09:05-17:05) - one email per subscriber per run and steps >= 48h apart -
each step claimed in the database before sending so it can never go out twice - unsubscribed/bounced/complained addresses are
re-checked immediately before sending - refuses to run without a postal address - 20-minute deadline - skips under 400 MB free disk.

## Env (`~/.simplyapply-drip/env`, chmod 600)
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `EMAIL_TOKEN_SECRET` (same value as the Fly app),
`EMAIL_POSTAL_ADDRESS`, optional `EMAIL_FROM`, `PUBLIC_SITE_URL`, `DRIP_MAX_PER_RUN`.
