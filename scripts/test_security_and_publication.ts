import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function runSecurityTests() {
  console.log('=====================================================');
  console.log('PENTRIC SECURITY & AUTHORITATIVE PUBLICATION TESTS');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(msg: string) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  }

  function fail(msg: string, err: any) {
    console.error(`  ✗ FAIL: ${msg}`, err);
    failed++;
  }

  // TEST 1: Anonymous /api/sync/state protection
  try {
    const res = await fetch(`${BASE_URL}/api/sync/state`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(data.keys, 'Keys map must be present in sync state');
    
    // Check that sensitive keys are absent
    const keys = Object.keys(data.keys || {});
    assert.ok(!keys.includes('ota_teachers_v2'), 'Teacher list with passwords/recovery codes must not be public');
    assert.ok(!keys.includes('ota_audit_logs'), 'Audit logs must not be public');
    assert.ok(!keys.includes('ota_timetable_history'), 'Timetable history must not be public');
    assert.ok(!keys.includes('ota_timetable_draft'), 'Timetable drafts must not be public');

    // Stringified check: ensure no password hashes or recovery codes leak
    const payloadStr = JSON.stringify(data);
    assert.ok(!payloadStr.includes('passwordHash'), 'No password hashes allowed in public state');
    assert.ok(!payloadStr.includes('recoveryCode'), 'No recovery codes allowed in public state');

    pass('Anonymous /api/sync/state does NOT expose teacher secrets, credentials, drafts, or recovery codes');
  } catch (e: any) {
    fail('Anonymous /api/sync/state leaked private data', e);
  }

  // TEST 2: Anonymous write to /api/sync/update is rejected (401/403)
  try {
    const res = await fetch(`${BASE_URL}/api/sync/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'ota_timetable_v2',
        value: { hacked: true }
      })
    });
    assert.ok(res.status === 401 || res.status === 403, 'Anonymous update must return 401/403');
    pass('Anonymous caller cannot modify state via /api/sync/update (Unauthorized)');
  } catch (e: any) {
    fail('Anonymous caller was able to mutate state or got unexpected response', e);
  }

  // TEST 3: Public timetable access works cleanly without secrets
  try {
    const res = await fetch(`${BASE_URL}/api/public/timetable`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(data.success);
    assert.ok(data.timetable !== undefined, 'Timetable must be present');
    
    const payloadStr = JSON.stringify(data);
    assert.ok(!payloadStr.includes('passwordHash'), 'No password hashes in public timetable');
    assert.ok(!payloadStr.includes('recoveryCode'), 'No recovery codes in public timetable');
    pass('Public timetable endpoint (/api/public/timetable) delivers schedule cleanly without leaking secrets');
  } catch (e: any) {
    fail('Public timetable endpoint failed', e);
  }

  // TEST 4: Anonymous call to /api/timetable/publish is rejected (401/403)
  try {
    const res = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timetable: { JS1A: {} }
      })
    });
    assert.ok(res.status === 401 || res.status === 403, 'Anonymous publication must return 401/403');
    pass('Anonymous caller cannot publish timetable via /api/timetable/publish (Forbidden/Unauthorized)');
  } catch (e: any) {
    fail('Anonymous caller was not blocked on /api/timetable/publish', e);
  }

  // TEST 5: Developer recovery endpoint blocks anonymous requests (401/403)
  try {
    const res = await fetch(`${BASE_URL}/api/developer/teachers`);
    assert.ok(res.status === 401 || res.status === 403);
    pass('Anonymous caller cannot enumerate teachers via developer endpoint (Forbidden/Unauthorized)');
  } catch (e: any) {
    fail('Developer endpoint failed to block anonymous request', e);
  }

  // TEST 6: Nonce / Reset security
  try {
    const res = await fetch(`${BASE_URL}/api/sync/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert.ok(res.status === 401 || res.status === 403);
    pass('Anonymous caller cannot wipe system data via /api/sync/reset (Forbidden/Unauthorized)');
  } catch (e: any) {
    fail('/api/sync/reset permitted unauthenticated reset', e);
  }

  // TEST 7: Authenticated admin can publish with baseline revision (baseRevisionId = 1) without false conflict
  let adminToken: string | null = null;
  let originalTimetable: any = null;
  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, 'Admin login must succeed');
    adminToken = loginData.token;
    assert.ok(adminToken, 'Auth token must be returned');

    // Fetch public state to know current revision and save original timetable
    const pubRes = await fetch(`${BASE_URL}/api/public/timetable`);
    const pubData = await pubRes.json();
    originalTimetable = pubData.timetable;
    const activeRev = pubData.metadata?.revisionId || 1;

    // Publish valid draft with baseRevisionId = activeRev
    const pubAttemptRes = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        timetable: { JS1A: { 0: { 0: { subjectId: 'eng', teacherId: 't1' } } } },
        baseRevisionId: activeRev,
        publisher: 'Administrator'
      })
    });
    const pubAttemptData = await pubAttemptRes.json();
    assert.strictEqual(pubAttemptRes.status, 200, `Publication must succeed without 409 conflict: ${pubAttemptData.error || ''}`);
    assert.strictEqual(pubAttemptData.success, true);
    assert.ok(pubAttemptData.revisionId > activeRev, 'Revision must increment monotonically');
    pass(`Admin published schedule successfully from Revision #${activeRev} to Revision #${pubAttemptData.revisionId} without false conflict`);

    // TEST 8: Stale baseRevisionId is cleanly rejected with 409, but force: true overrides
    const staleRes = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        timetable: { JS1A: { 0: { 0: { subjectId: 'math', teacherId: 't1' } } } },
        baseRevisionId: 1, // Intentional stale revision
        publisher: 'Administrator'
      })
    });
    assert.strictEqual(staleRes.status, 409, 'Stale publication without force must return 409 Conflict');
    pass('Stale publication properly returns 409 Conflict with current revision details');

    // Force publish override
    const forceRes = await fetch(`${BASE_URL}/api/timetable/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        timetable: { JS1A: { 0: { 0: { subjectId: 'math', teacherId: 't1' } } } },
        baseRevisionId: 1,
        force: true,
        publisher: 'Administrator'
      })
    });
    const forceData = await forceRes.json();
    assert.strictEqual(forceRes.status, 200, `Force publication must succeed: ${forceData.error || ''}`);
    assert.strictEqual(forceData.success, true);
    pass(`Force-publish successfully resolved conflict and advanced to Revision #${forceData.revisionId}`);
  } catch (e: any) {
    fail('Publication revision concurrency tests failed', e);
  } finally {
    // Restore original timetable so test does not degrade system state
    if (adminToken && originalTimetable && Object.keys(originalTimetable).length > 1) {
      try {
        await fetch(`${BASE_URL}/api/timetable/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
          },
          body: JSON.stringify({
            timetable: originalTimetable,
            baseRevisionId: 1,
            force: true,
            publisher: 'system_restoration'
          })
        });
      } catch {}
    }
  }

  console.log('\n=====================================================');
  console.log(`SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
