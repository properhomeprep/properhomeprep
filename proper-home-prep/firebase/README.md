# Proper Home Prep — Firebase backend (rules + tests)

Firebase project: `dashboard-claudev2` (check Firebase console > Project settings; if the
real Project ID differs, change it in `.firebaserc` and `scripts/set-role.js`).

**Status: drafted, not yet run.** The rules and the 55 tests were written together but have
not been executed against the Firestore emulator. Do not rely on the rules for real data
until the tests pass (step 1). Your database is safely locked by default (production mode)
until you publish rules, so there is no hurry.

## 1. Run the tests (about 5 minutes, free, in your browser)

1. Open https://shell.cloud.google.com (Google Cloud Shell; it already has Node and Java).
2. Upload the repository zip (three-dot menu > Upload), then:

   ```
   unzip proper-home-prep.zip && cd proper-home-prep/firebase
   npm install
   npm test
   ```
3. You want to see `# pass 55` and `# fail 0`. If anything fails, copy the output to Claude.

## 2. Publish the rules (only after step 1 passes)

Easiest: Firebase console > Firestore Database > Rules tab > paste the contents of
`firestore.rules` > Publish. The console also checks the syntax for you.
(Or from Cloud Shell: `npx firebase login --no-localhost` then `npx firebase deploy --only firestore:rules`.)

## 3. Create your first admin

Rules only let the server hand out roles, so the very first admin is created by script:

1. Firebase console > Authentication > Get started > turn on **Email/Password**.
2. Authentication > Users > **Add user** (your email + a password).
3. In Cloud Shell, from this `firebase` folder:

   ```
   npm install
   node scripts/set-role.js you@yourdomain.com admin
   ```
4. Sign out and back in so the role takes effect.

Same script makes techs and hosts: `node scripts/set-role.js tech@example.com tech`.

## What the rules enforce (see the Firebase Backend Design doc)

- Hosts see only their own properties and jobs, read-only. They never see entry codes.
- Entry codes live in `private` documents: admin-only on a property; readable by the
  assigned tech on a job until sign-off.
- Techs can clock in, check off tasks, add photos and flags on their own open jobs, with
  server timestamps. They cannot complete a job (a server function will do that later).
- Leads (`inquiries`) are admin-only. `onboardingCodes` and `users` are server-only to write.
