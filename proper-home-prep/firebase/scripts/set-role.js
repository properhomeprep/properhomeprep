// One-time / occasional admin tool: give a user a role (admin | tech | host).
//
// Roles can only be set from a trusted server — never from the browser — which is
// what stops anyone from promoting themselves. Run this from Google Cloud Shell,
// where you are already signed in to your own Google account, so no key file is needed.
//
//   node scripts/set-role.js someone@example.com admin
//
// The person must already exist under Firebase console > Authentication > Users.
// After running it they have to sign out and back in for the new role to apply.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const [email, role] = process.argv.slice(2);
if (!email || !['admin', 'tech', 'host'].includes(role)) {
  console.error('Usage: node scripts/set-role.js <email> <admin|tech|host>');
  process.exit(1);
}

initializeApp({ projectId: 'dashboard-claudev2' });

const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { role });
await getFirestore().doc(`users/${user.uid}`).set(
  { role, name: user.displayName || '', email, active: true },
  { merge: true }
);
console.log(`Done: ${email} (${user.uid}) is now "${role}". They must sign out and back in.`);
