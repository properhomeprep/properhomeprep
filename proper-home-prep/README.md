# Proper Home Prep

*Where Every Detail Matters.*

Website, host dashboard, onboarding documents, and backend rules for Proper Home Prep (Nashville, TN).

## What's where

| Folder | What it is | Published? |
|---|---|---|
| `site/` | Public website: services & pricing page (`index.html`) and the quote request form | Yes → properhomeprep.com |
| `dashboard/` | The Admin / Tech / Host dashboard (`index.html`) and host onboarding forms in `onboard/` | Yes → dashboard.properhomeprep.com |
| `internal-docs/` | Tech field guide, onboarding templates, brand files, marketing kits, printable PDFs, archive | **No** — never published |
| `firebase/` | Database security rules, tests, and the first-admin script | Deployed to Firebase, not Netlify |

## Publishing (Netlify)

One repository, two Netlify sites. In Netlify: **Add new site → Import an existing project →** pick this repo, then:

| Site | Publish directory | Build command | Domain |
|---|---|---|---|
| Website | `site` | *(leave empty)* | properhomeprep.com |
| Dashboard | `dashboard` | *(leave empty)* | dashboard.properhomeprep.com |

Because only `site/` and `dashboard/` are published, nothing in `internal-docs/` or `firebase/` can ever be reached online.
`dashboard/_headers` asks search engines not to index the dashboard or onboarding pages.

**Before connecting your existing Netlify site to this repo:** check what is live there now. Connecting a repo replaces the site's contents with these folders.

## Rules for this repo

- **Never commit** service-account or private key files, passwords, or real customer data. `.gitignore` blocks the usual key file names, but it can't catch everything.
- Firebase *web config* values (apiKey, projectId, etc.) are meant to be public and are safe to commit.
- Keep financial and HR documents (investor plan, pay details) out of the repo. Git remembers everything you ever committed, so deleting a file later does not make it private again.

## Current status

The dashboard is still a working prototype that stores its data in the browser. Moving it onto Firebase (login, database, photo storage) is the next build phase — see `firebase/README.md` and the Firebase Backend Design document.
