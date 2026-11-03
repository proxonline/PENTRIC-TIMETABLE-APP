import assert from 'node:assert';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

const PORT_A = 3000;
const PORT_B = 3005;
const BASE_A = `http://localhost:${PORT_A}`;
const BASE_B = `http://localhost:${PORT_B}`;

async function waitForServer(url: string, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/ready`);
      if (res.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

async function runMultiInstanceSyncTest() {
  console.log('=====================================================');
  console.log('PENTRIC MULTI-INSTANCE CROSS-DEVICE SYNC TEST');
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

  // 1. Verify Instance A is running
  const aReady = await waitForServer(BASE_A, 5);
  if (!aReady) {
    throw new Error(`Primary Instance A on port ${PORT_A} is not responding`);
  }
  pass(`Instance A operational on port ${PORT_A}`);

  // 2. Spawn Instance B on PORT 3005
  console.log(`Starting secondary Instance B on port ${PORT_B}...`);
  let instanceB: ChildProcess | null = null;
  try {
    instanceB = spawn('npx', ['tsx', 'server.ts'], {
      env: {
        ...process.env,
        PORT: String(PORT_B),
        NODE_ENV: 'test'
      },
      stdio: 'ignore'
    });

    const bReady = await waitForServer(BASE_B, 30);
    assert.ok(bReady, `Instance B must become ready on port ${PORT_B}`);
    pass(`Instance B started and operational on port ${PORT_B}`);

    // 3. Register teacher on Instance A
    const testEmail = `sync_teach_${Date.now()}@pentric.edu`;
    const testUsername = `sync_${Date.now().toString(36)}`;
    const testPassword = 'CrossDevicePassword2026!';
    const testName = 'Prof. Alan Turing';

    const codeRes = await fetch(`${BASE_A}/api/auth/send-verification-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, username: testUsername, name: testName })
    });
    const codeData = await codeRes.json();
    assert.strictEqual(codeRes.status, 200);

    const fs = await import('fs');
    const list = JSON.parse(fs.readFileSync('data/pending_verifications.json', 'utf8'));
    const match = list.find((item: any) => item && item.email === testEmail);
    assert.ok(match, 'Pending verification must exist');
    const code = match.code;

    const signupRes = await fetch(`${BASE_A}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testName,
        username: testUsername,
        email: testEmail,
        password: testPassword,
        verificationCode: code,
        schoolId: 'ota_total_academy'
      })
    });
    const signupData = await signupRes.json();
    assert.strictEqual(signupRes.status, 200);
    const teacherId = signupData.user.id;
    pass(`Teacher registered on Instance A with ID: ${teacherId}`);

    // 4. Test Pre-Approval rejection on Instance B (Cross-device status sync)
    // Wait briefly for disk / snapshot sync
    await new Promise(r => setTimeout(r, 600));

    const preApproveOnB = await fetch(`${BASE_B}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        role: 'TEACHER'
      })
    });
    const preDataB = await preApproveOnB.json();
    assert.strictEqual(preApproveOnB.status, 403, 'Pre-approval login on Instance B must return 403');
    assert.strictEqual(preDataB.code, 'ACCOUNT_PENDING_APPROVAL');
    pass('Instance B recognized pending teacher registered on Instance A (ACCOUNT_PENDING_APPROVAL)');

    // 5. Admin on Instance B approves the teacher
    const adminLoginB = await fetch(`${BASE_B}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'ADMIN' })
    });
    const adminDataB = await adminLoginB.json();
    assert.strictEqual(adminLoginB.status, 200);
    const adminTokenB = adminDataB.token;

    const approveOnB = await fetch(`${BASE_B}/api/teachers/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminTokenB}`
      },
      body: JSON.stringify({
        teacherId,
        action: 'APPROVE',
        adminName: 'Device B Admin'
      })
    });
    assert.strictEqual(approveOnB.status, 200);
    pass('Administrator on Instance B approved teacher successfully');

    // 6. Teacher can now log in on Instance A and Instance B
    await new Promise(r => setTimeout(r, 600));

    const loginOnA = await fetch(`${BASE_A}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: testPassword,
        role: 'TEACHER'
      })
    });
    const loginDataA = await loginOnA.json();
    assert.strictEqual(loginOnA.status, 200, `Login on Instance A failed: ${JSON.stringify(loginDataA)}`);
    assert.ok(loginDataA.token);
    pass('Approved teacher can immediately log in on Instance A');

    const loginOnB = await fetch(`${BASE_B}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testEmail, // Test login with Email identifier on Instance B
        password: testPassword,
        role: 'TEACHER'
      })
    });
    const loginDataB = await loginOnB.json();
    assert.strictEqual(loginOnB.status, 200, `Login on Instance B failed: ${JSON.stringify(loginDataB)}`);
    assert.ok(loginDataB.token);
    pass('Approved teacher can immediately log in via Email on Instance B');

    // 7. Teacher changes password on Instance A
    const newPass = 'UpdatedMultiDevicePass99!';
    const changePassRes = await fetch(`${BASE_A}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loginDataA.token}`
      },
      body: JSON.stringify({
        id: teacherId,
        role: 'TEACHER',
        oldPassword: testPassword,
        newPassword: newPass
      })
    });
    assert.strictEqual(changePassRes.status, 200);
    pass('Teacher updated password on Instance A');

    // 8. Teacher logs in with new password on Instance B
    await new Promise(r => setTimeout(r, 600));

    const newLoginB = await fetch(`${BASE_B}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: newPass,
        role: 'TEACHER'
      })
    });
    assert.strictEqual(newLoginB.status, 200, 'New password must work on Instance B');
    pass('Updated password immediately synchronized and authenticated on Instance B');

  } catch (e: any) {
    fail('Multi-instance sync failed', e);
  } finally {
    if (instanceB) {
      instanceB.kill('SIGKILL');
    }
  }

  console.log('\n=====================================================');
  console.log(`MULTI-INSTANCE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runMultiInstanceSyncTest().catch(err => {
  console.error('Fatal multi-instance test error:', err);
  process.exit(1);
});
