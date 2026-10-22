// Tests for firestore.rules — run with `npm test` (starts the Firestore emulator for you).
import { readFileSync } from 'node:fs';
import { describe, it, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';

let testEnv;

// Who is who in these tests
//   admin1            admin
//   techA / techB     techs (techA works jobs j1 + j3, techB works j2)
//   hostA / hostB     hosts (hostA owns property p1, hostB owns p2)
const as = (uid, role) => testEnv.authenticatedContext(uid, role ? { role } : {}).firestore();
const admin = () => as('admin1', 'admin');
const techA = () => as('techA', 'tech');
const techB = () => as('techB', 'tech');
const hostA = () => as('hostA', 'host');
const hostB = () => as('hostB', 'host');
const anon = () => testEnv.unauthenticatedContext().firestore();

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-proper-home-prep',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'users/hostA'), { role: 'host', name: 'Host A' });
    await setDoc(doc(db, 'users/hostB'), { role: 'host', name: 'Host B' });

    // Properties (p1 -> hostA, p2 -> hostB) with private docs
    await setDoc(doc(db, 'properties/p1'), { nickname: 'Gulch Loft', clientUids: ['hostA'] });
    await setDoc(doc(db, 'properties/p2'), { nickname: 'Riverbend Cabin', clientUids: ['hostB'] });
    await setDoc(doc(db, 'properties/p1/private/access'), { entryCode: '2847#' });
    await setDoc(doc(db, 'properties/p1/private/hostContact'), { phone: '(615) 555-0100' });

    // Jobs: j1 in progress (techA/hostA), j2 not started (techB/hostB), j3 complete (techA/hostA)
    await setDoc(doc(db, 'jobs/j1'), { propertyId: 'p1', techUid: 'techA', clientUids: ['hostA'], status: 'in_progress', clockIn: now });
    await setDoc(doc(db, 'jobs/j2'), { propertyId: 'p2', techUid: 'techB', clientUids: ['hostB'], status: 'not_started', clockIn: null });
    await setDoc(doc(db, 'jobs/j3'), { propertyId: 'p1', techUid: 'techA', clientUids: ['hostA'], status: 'complete', clockIn: now });
    for (const j of ['j1', 'j2', 'j3']) {
      await setDoc(doc(db, `jobs/${j}/private/access`), { entryCode: '2847#' });
      await setDoc(doc(db, `jobs/${j}/tasks/t1`), { section: 'Kitchen', label: 'Wipe counters', done: false, doneAt: null });
    }
    await setDoc(doc(db, 'jobs/j1/photos/ph1'), { area: 'Kitchen', phase: 'before', storagePath: 'jobs/j1/photos/ph1.jpg', takenAt: now, takenBy: 'techA' });
    await setDoc(doc(db, 'jobs/j1/flags/f1'), { severity: 'routine', description: 'Bulb out', createdAt: now, createdBy: 'techA' });
    await setDoc(doc(db, 'inquiries/q1'), { name: 'Sample Lead', status: 'new' });
    await setDoc(doc(db, 'onboardingCodes/PHP-AAAA'), { propertyId: 'p1' });
  });
});

describe('not signed in / no role', () => {
  it('cannot read anything', async () => {
    await assertFails(getDoc(doc(anon(), 'properties/p1')));
    await assertFails(getDoc(doc(anon(), 'jobs/j1')));
    await assertFails(getDoc(doc(anon(), 'inquiries/q1')));
  });
  it('a signed-in user with NO role claim can read nothing', async () => {
    const nobody = as('nobody', null);
    await assertFails(getDoc(doc(nobody, 'properties/p1')));
    await assertFails(getDoc(doc(nobody, 'jobs/j1')));
  });
  it('anything outside the known collections is denied, even for admins', async () => {
    await assertFails(getDoc(doc(admin(), 'secrets/x')));
    await assertFails(setDoc(doc(admin(), 'secrets/x'), { a: 1 }));
  });
});

describe('users', () => {
  it('a user can read their own profile but not someone else\'s', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'users/hostA')));
    await assertFails(getDoc(doc(hostA(), 'users/hostB')));
  });
  it('admins can read any profile', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'users/hostA')));
  });
  it('NOBODY can write a user doc from the client (no self-promotion to admin)', async () => {
    await assertFails(setDoc(doc(hostA(), 'users/hostA'), { role: 'admin' }));
    await assertFails(updateDoc(doc(hostA(), 'users/hostA'), { role: 'admin' }));
    await assertFails(setDoc(doc(admin(), 'users/newperson'), { role: 'tech' }));
  });
});

describe('properties', () => {
  it('a host reads their own property but not another host\'s', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'properties/p1')));
    await assertFails(getDoc(doc(hostA(), 'properties/p2')));
  });
  it('a host can list their own properties, but not list everything', async () => {
    await assertSucceeds(getDocs(query(collection(hostA(), 'properties'), where('clientUids', 'array-contains', 'hostA'))));
    await assertFails(getDocs(collection(hostA(), 'properties')));
  });
  it('techs and admins can read property profiles', async () => {
    await assertSucceeds(getDoc(doc(techA(), 'properties/p1')));
    await assertSucceeds(getDoc(doc(techB(), 'properties/p1')));
    await assertSucceeds(getDoc(doc(admin(), 'properties/p1')));
  });
  it('ENTRY CODES: private docs are admin-only — never hosts, never techs', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'properties/p1/private/access')));
    await assertFails(getDoc(doc(hostA(), 'properties/p1/private/access')));   // the host's OWN property
    await assertFails(getDoc(doc(techA(), 'properties/p1/private/access')));
    await assertFails(getDoc(doc(anon(), 'properties/p1/private/access')));
  });
  it('host contact details are admin-only too', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'properties/p1/private/hostContact')));
    await assertFails(getDoc(doc(hostA(), 'properties/p1/private/hostContact')));
    await assertFails(getDoc(doc(techA(), 'properties/p1/private/hostContact')));
  });
  it('only admins can create, edit, or delete properties', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'properties/p1'), { nickname: 'Renamed' }));
    await assertSucceeds(setDoc(doc(admin(), 'properties/p3'), { nickname: 'New', clientUids: [] }));
    await assertFails(updateDoc(doc(techA(), 'properties/p1'), { nickname: 'x' }));
    await assertFails(updateDoc(doc(hostA(), 'properties/p1'), { nickname: 'x' }));
    await assertFails(setDoc(doc(hostA(), 'properties/p9'), { nickname: 'x', clientUids: ['hostA'] }));
    await assertFails(deleteDoc(doc(hostA(), 'properties/p1')));
  });
  it('a host cannot add themselves to someone else\'s property', async () => {
    await assertFails(updateDoc(doc(hostB(), 'properties/p1'), { clientUids: ['hostA', 'hostB'] }));
  });
});

describe('jobs: who can see them', () => {
  it('hosts see only their own jobs', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'jobs/j1')));
    await assertFails(getDoc(doc(hostA(), 'jobs/j2')));
    await assertSucceeds(getDocs(query(collection(hostA(), 'jobs'), where('clientUids', 'array-contains', 'hostA'))));
    await assertFails(getDocs(collection(hostA(), 'jobs')));
  });
  it('techs see only jobs assigned to them', async () => {
    await assertSucceeds(getDoc(doc(techA(), 'jobs/j1')));
    await assertFails(getDoc(doc(techA(), 'jobs/j2')));
    await assertSucceeds(getDocs(query(collection(techA(), 'jobs'), where('techUid', '==', 'techA'))));
    await assertFails(getDocs(collection(techA(), 'jobs')));
  });
  it('admins see everything', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'jobs')));
  });
  it('hosts cannot create or edit jobs', async () => {
    await assertFails(updateDoc(doc(hostA(), 'jobs/j1'), { status: 'complete' }));
    await assertFails(setDoc(doc(hostA(), 'jobs/jx'), { propertyId: 'p1', techUid: 'techA', clientUids: ['hostA'], status: 'not_started' }));
  });
  it('only admins create or delete jobs', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'jobs/jx'), { propertyId: 'p1', techUid: 'techA', clientUids: ['hostA'], status: 'not_started' }));
    await assertFails(setDoc(doc(techA(), 'jobs/jy'), { propertyId: 'p1', techUid: 'techA', clientUids: ['hostA'], status: 'not_started' }));
    await assertFails(deleteDoc(doc(techA(), 'jobs/j1')));
  });
});

describe('jobs: what a tech can change', () => {
  it('clock in: not_started -> in_progress with a server timestamp', async () => {
    await assertSucceeds(updateDoc(doc(techB(), 'jobs/j2'), { status: 'in_progress', clockIn: serverTimestamp() }));
  });
  it('clock-in time cannot be backdated', async () => {
    await assertFails(updateDoc(doc(techB(), 'jobs/j2'), { status: 'in_progress', clockIn: Timestamp.fromDate(new Date('2020-01-01')) }));
  });
  it('cannot go in_progress without recording a clock-in', async () => {
    await assertFails(updateDoc(doc(techB(), 'jobs/j2'), { status: 'in_progress' }));
  });
  it('a tech can NOT mark a job complete (server-only)', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1'), { status: 'complete' }));
    await assertFails(updateDoc(doc(techB(), 'jobs/j2'), { status: 'complete' }));
  });
  it('a tech cannot reassign a job, change its property, or tamper with who can see it', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1'), { techUid: 'techB' }));
    await assertFails(updateDoc(doc(techA(), 'jobs/j1'), { propertyId: 'p2' }));
    await assertFails(updateDoc(doc(techA(), 'jobs/j1'), { clientUids: ['hostB'] }));
  });
  it('a tech cannot touch another tech\'s job', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j2'), { status: 'in_progress', clockIn: serverTimestamp() }));
  });
  it('a completed job is locked for techs', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j3'), { laundryStarted: true }));
  });
  it('a tech can toggle laundryStarted on their own open job', async () => {
    await assertSucceeds(updateDoc(doc(techA(), 'jobs/j1'), { laundryStarted: true }));
  });
  it('admins can edit any job, including completing it', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'jobs/j1'), { status: 'complete' }));
  });
});

describe('jobs: entry-info snapshot (private/access)', () => {
  it('the assigned tech can read it before and during the job', async () => {
    await assertSucceeds(getDoc(doc(techA(), 'jobs/j1/private/access')));
    await assertSucceeds(getDoc(doc(techB(), 'jobs/j2/private/access')));
  });
  it('...but NOT after sign-off', async () => {
    await assertFails(getDoc(doc(techA(), 'jobs/j3/private/access')));
  });
  it('a different tech can never read it', async () => {
    await assertFails(getDoc(doc(techB(), 'jobs/j1/private/access')));
  });
  it('hosts can never read it', async () => {
    await assertFails(getDoc(doc(hostA(), 'jobs/j1/private/access')));
  });
  it('admins can read and write it; techs cannot write it', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'jobs/j3/private/access')));
    await assertSucceeds(setDoc(doc(admin(), 'jobs/j1/private/access'), { entryCode: '9999' }));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/private/access'), { entryCode: '9999' }));
  });
});

describe('tasks', () => {
  it('assigned tech can check a task on an in-progress job (server timestamp)', async () => {
    await assertSucceeds(updateDoc(doc(techA(), 'jobs/j1/tasks/t1'), { done: true, doneAt: serverTimestamp() }));
  });
  it('...and uncheck it again', async () => {
    await assertSucceeds(updateDoc(doc(techA(), 'jobs/j1/tasks/t1'), { done: true, doneAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(techA(), 'jobs/j1/tasks/t1'), { done: false, doneAt: null }));
  });
  it('check-off time cannot be backdated', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1/tasks/t1'), { done: true, doneAt: Timestamp.fromDate(new Date('2020-01-01')) }));
  });
  it('a tech cannot rewrite the checklist itself', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1/tasks/t1'), { label: 'Do nothing' }));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/tasks/new'), { section: 'Kitchen', label: 'x', done: false, doneAt: null }));
    await assertFails(deleteDoc(doc(techA(), 'jobs/j1/tasks/t1')));
  });
  it('no task changes before clock-in or after sign-off', async () => {
    await assertFails(updateDoc(doc(techB(), 'jobs/j2/tasks/t1'), { done: true, doneAt: serverTimestamp() }));  // not started
    await assertFails(updateDoc(doc(techA(), 'jobs/j3/tasks/t1'), { done: true, doneAt: serverTimestamp() }));  // complete
  });
  it('the wrong tech cannot check tasks', async () => {
    await assertFails(updateDoc(doc(techB(), 'jobs/j1/tasks/t1'), { done: true, doneAt: serverTimestamp() }));
  });
  it('hosts can read their job\'s tasks but never change them; other hosts see nothing', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'jobs/j1/tasks/t1')));
    await assertSucceeds(getDocs(collection(hostA(), 'jobs/j1/tasks')));
    await assertFails(updateDoc(doc(hostA(), 'jobs/j1/tasks/t1'), { done: true, doneAt: serverTimestamp() }));
    await assertFails(getDoc(doc(hostB(), 'jobs/j1/tasks/t1')));
  });
});

describe('photos', () => {
  const photo = (over = {}) => ({
    area: 'Kitchen', phase: 'before', storagePath: 'jobs/j1/photos/new.jpg',
    takenAt: serverTimestamp(), takenBy: 'techA', ...over,
  });
  it('assigned tech can add a photo to an in-progress job', async () => {
    await assertSucceeds(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo()));
  });
  it('photo must be credited to the tech who took it, with server time', async () => {
    await assertFails(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo({ takenBy: 'techB' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo({ takenAt: Timestamp.fromDate(new Date('2020-01-01')) })));
  });
  it('photo file path must belong to THIS job (no attaching another job\'s photo)', async () => {
    await assertFails(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo({ storagePath: 'jobs/j2/photos/x.jpg' })));
  });
  it('rejects unknown fields and invalid phases', async () => {
    await assertFails(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo({ extra: 'nope' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/photos/new'), photo({ phase: 'during' })));
  });
  it('no photos before clock-in, after sign-off, or by another tech', async () => {
    await assertFails(setDoc(doc(techB(), 'jobs/j2/photos/new'), photo({ takenBy: 'techB', storagePath: 'jobs/j2/photos/x.jpg' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j3/photos/new'), photo({ storagePath: 'jobs/j3/photos/x.jpg' })));
    await assertFails(setDoc(doc(techB(), 'jobs/j1/photos/new'), photo({ takenBy: 'techB' })));
  });
  it('photos are an audit trail: techs cannot edit or delete them', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1/photos/ph1'), { area: 'Bathroom 1' }));
    await assertFails(deleteDoc(doc(techA(), 'jobs/j1/photos/ph1')));
  });
  it('hosts can see their job\'s photos but not add them; others see nothing', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'jobs/j1/photos/ph1')));
    await assertFails(setDoc(doc(hostA(), 'jobs/j1/photos/new'), photo({ takenBy: 'hostA' })));
    await assertFails(getDoc(doc(hostB(), 'jobs/j1/photos/ph1')));
  });
  it('admins can delete a wrong photo', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'jobs/j1/photos/ph1')));
  });
});

describe('flags', () => {
  const flag = (over = {}) => ({
    severity: 'attention', description: 'Coffee maker will not power on',
    createdAt: serverTimestamp(), createdBy: 'techA', ...over,
  });
  it('assigned tech can raise a flag, even before clocking in', async () => {
    await assertSucceeds(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag()));
    await assertSucceeds(setDoc(doc(techB(), 'jobs/j2/flags/new'), flag({ createdBy: 'techB' })));
  });
  it('accepts tags and a photo path from this job', async () => {
    await assertSucceeds(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ tags: ['Damaged appliance'], photoPath: 'jobs/j1/photos/f.jpg' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ photoPath: 'jobs/j2/photos/f.jpg' })));
  });
  it('rejects bad severity, empty or oversized descriptions, wrong author, backdating', async () => {
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ severity: 'meh' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ description: '' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ description: 'x'.repeat(2001) })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ createdBy: 'techB' })));
    await assertFails(setDoc(doc(techA(), 'jobs/j1/flags/new'), flag({ createdAt: Timestamp.fromDate(new Date('2020-01-01')) })));
  });
  it('no flags on a completed job or on someone else\'s job', async () => {
    await assertFails(setDoc(doc(techA(), 'jobs/j3/flags/new'), flag()));
    await assertFails(setDoc(doc(techB(), 'jobs/j1/flags/new'), flag({ createdBy: 'techB' })));
  });
  it('flags cannot be edited or deleted by the tech who raised them', async () => {
    await assertFails(updateDoc(doc(techA(), 'jobs/j1/flags/f1'), { description: 'Never mind' }));
    await assertFails(deleteDoc(doc(techA(), 'jobs/j1/flags/f1')));
  });
  it('hosts can read flags on their jobs but never create them; others see nothing', async () => {
    await assertSucceeds(getDoc(doc(hostA(), 'jobs/j1/flags/f1')));
    await assertFails(setDoc(doc(hostA(), 'jobs/j1/flags/new'), flag({ createdBy: 'hostA' })));
    await assertFails(getDoc(doc(hostB(), 'jobs/j1/flags/f1')));
  });
});

describe('inquiries and onboarding codes', () => {
  it('inquiries are admin-only (read and write)', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'inquiries/q1')));
    await assertSucceeds(updateDoc(doc(admin(), 'inquiries/q1'), { status: 'contacted' }));
    await assertFails(getDoc(doc(techA(), 'inquiries/q1')));
    await assertFails(getDoc(doc(hostA(), 'inquiries/q1')));
    await assertFails(getDoc(doc(anon(), 'inquiries/q1')));
    await assertFails(setDoc(doc(anon(), 'inquiries/new'), { name: 'Spam' }));
  });
  it('onboarding codes cannot be touched from the client by anyone, admins included', async () => {
    await assertFails(getDoc(doc(admin(), 'onboardingCodes/PHP-AAAA')));
    await assertFails(setDoc(doc(admin(), 'onboardingCodes/PHP-BBBB'), { propertyId: 'p1' }));
    await assertFails(getDoc(doc(hostA(), 'onboardingCodes/PHP-AAAA')));
  });
});
