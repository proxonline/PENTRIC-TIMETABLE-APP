import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

async function runTests() {
  console.log('=== PENTRIC P0 & P1 VERIFICATION AND REGRESSION TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name}`);
      failed++;
    }
  }

  const BASE_URL = 'http://localhost:3000';
  const JWT_SECRET = process.env.JWT_SECRET || 'ota_smart_secret_key_dev';
  const adminToken = jwt.sign({ id: 'admin_test', username: 'admin', role: 'ADMIN' }, JWT_SECRET);
  const teacherToken = jwt.sign({ id: 'teacher_test', username: 'teacher', role: 'TEACHER' }, JWT_SECRET);

  // 1. P0-1: Check services/storage.ts getTimetable() does not have automatic historical rollback
  try {
    const storageCode = fs.readFileSync(path.join(process.cwd(), 'services/storage.ts'), 'utf-8');
    const hasHistoryRollback = storageCode.includes('storage.getHistory()') && storageCode.includes('localStorage.setItem(KEYS.TIMETABLE, JSON.stringify(entry.snapshot))');
    assert(!hasHistoryRollback, 'P0-1: getTimetable() has NO implicit historical rollback');
  } catch (e: any) {
    assert(false, 'P0-1: ' + e?.message);
  }

  // 2. P0-3: Public anonymous access to /api/sync/state must NEVER expose private records or credentials
  try {
    const res = await fetch(`${BASE_URL}/api/sync/state`);
    const data = await res.json();
    assert(res.ok, 'P0-3: /api/sync/state returns 200 for public viewers');
    assert(!data.keys?.ota_admins, 'P0-3: Public /api/sync/state hides ota_admins');
    assert(!data.keys?.ota_timetable_draft_v1, 'P0-3: Public /api/sync/state hides unpublished drafts');
    assert(!data.keys?.ota_audit_logs_v1, 'P0-3: Public /api/sync/state hides audit logs');

    let leakedSecrets = false;
    if (data.keys?.ota_teachers_v3) {
      for (const t of data.keys.ota_teachers_v3) {
        if (t.password || t.recoveryCode || t.calendarToken || t.contactEmail) {
          leakedSecrets = true;
          break;
        }
      }
    }
    assert(!leakedSecrets, 'P0-3: Public /api/sync/state teachers list contains NO passwords, recovery codes, or emails');
  } catch (e: any) {
    assert(false, 'P0-3: ' + e?.message);
  }

  // 3. P0-3: GET /api/public/timetable returns safely
  try {
    const res = await fetch(`${BASE_URL}/api/public/timetable`);
    const data = await res.json();
    assert(res.ok && data.success === true, 'P0-3: /api/public/timetable succeeds');
    assert(data.timetable !== undefined, 'P0-3: /api/public/timetable returns timetable field');
  } catch (e: any) {
    assert(false, 'P0-3: ' + e?.message);
  }

  // 4. P0-3: /api/sync/update rejects unauthenticated callers
  try {
    const res = await fetch(`${BASE_URL}/api/sync/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'ota_settings', data: { test: true } })
    });
    assert(res.status === 401, 'P0-3: Unauthenticated /api/sync/update returns 401 Unauthorized');
  } catch (e: any) {
    assert(false, 'P0-3: ' + e?.message);
  }

  // 5. P0-3: Teacher cannot modify system configuration or other teacher profiles via /api/sync/update
  try {
    const res = await fetch(`${BASE_URL}/api/sync/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ key: 'ota_settings', data: { test: true } })
    });
    assert(res.status === 403, 'P0-3: Teacher forbidden from modifying ota_settings via /api/sync/update');
  } catch (e: any) {
    assert(false, 'P0-3: ' + e?.message);
  }

  // 6. P0-2: /api/timetable/publish rejects unauthenticated and non-admin callers
  try {
    const resAnon = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timetable: { class1: {} } })
    });
    assert(resAnon.status === 401 || resAnon.status === 403, 'P0-2: Unauthenticated /api/timetable/publish rejected');

    const resTeacher = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${teacherToken}`
      },
      body: JSON.stringify({ timetable: { class1: {} } })
    });
    assert(resTeacher.status === 403, 'P0-2: Teacher forbidden from /api/timetable/publish');
  } catch (e: any) {
    assert(false, 'P0-2: ' + e?.message);
  }

  // 7. P0-2: Authoritative publish and conflict rejection
  try {
    // First get current revision from server
    const stateRes = await fetch(`${BASE_URL}/api/public/timetable`);
    const stateData = await stateRes.json();
    const currentRev = stateData.metadata?.revisionId || 0;

    // Publish new revision with matching baseRevisionId
    const testGrid = {
      'class_test': {
        0: { 0: { subjectId: 'MATH', teacherId: 't1' } }
      }
    };

    const pubRes = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        timetable: testGrid,
        baseRevisionId: currentRev,
        publisher: 'Test Admin'
      })
    });
    const pubData = await pubRes.json();
    assert(pubRes.ok && pubData.success === true, 'P0-2: Admin publish succeeds with correct baseRevisionId');
    assert(pubData.revisionId === currentRev + 1, 'P0-2: Server increments revisionId monotonically');
    assert(pubData.timetable._revisionId === currentRev + 1, 'P0-2: Timetable structure tagged with _revisionId');

    // Concurrency conflict test: attempt publishing again with the OLD baseRevisionId
    const conflictRes = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        timetable: testGrid,
        baseRevisionId: currentRev, // Stale!
        publisher: 'Concurrent Admin'
      })
    });
    assert(conflictRes.status === 409, 'P0-2: Stale concurrent publication rejected with 409 Conflict');
  } catch (e: any) {
    assert(false, 'P0-2: ' + e?.message);
  }

  // 8. P0-5 & P0-6: Auth.tsx does not have client-side teacher creation fallback
  try {
    const authCode = fs.readFileSync(path.join(process.cwd(), 'components/Auth.tsx'), 'utf-8');
    const hasClientTeacherFallback = authCode.includes('storage.saveTeacher(newTeacher)');
    assert(!hasClientTeacherFallback, 'P0-5: Auth.tsx has NO client-side teacher registration fallback');
  } catch (e: any) {
    assert(false, 'P0-5: ' + e?.message);
  }

  // 9. P0-4: Firestore rules and database.rules.json security
  try {
    const fRules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf-8');
    assert(!fRules.includes('match /ota_app_store/{key} {\n      allow read, write: if true;'), 'P0-4: firestore.rules does not allow public write to ota_app_store');
    const dRules = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'database.rules.json'), 'utf-8'));
    assert(dRules.rules?.['.read'] === false && dRules.rules?.['.write'] === false, 'P0-4: database.rules.json locks read and write to false');
  } catch (e: any) {
    assert(false, 'P0-4: ' + e?.message);
  }

  // 10. P1-8 & P1-9: Gitignore and env
  try {
    const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf-8');
    assert(gitignore.includes('.env'), 'P1-9: .gitignore includes .env');
    const envExample = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf-8');
    assert(!envExample.includes('ota_smart_secret_key_2026'), 'P1-8: .env.example does not contain hardcoded secret');
  } catch (e: any) {
    assert(false, 'P1-8/9: ' + e?.message);
  }

  console.log(`\n========================================`);
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
