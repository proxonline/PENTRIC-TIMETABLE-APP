import assert from 'node:assert';

const BASE_URL = 'http://localhost:3000';

async function runAuthMatrixTests() {
  console.log('=====================================================');
  console.log('PENTRIC AUTHENTICATION ERROR MATRIX & SECURITY SUITE');
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

  // 1. Test /api/ready endpoint
  try {
    const res = await fetch(`${BASE_URL}/api/ready`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'ready');
    assert.ok(data.vault?.vaultReady, 'Vault must be ready');
    assert.ok(typeof data.records?.teachersCount === 'number');
    pass('Readiness check endpoint (/api/ready) reports operational state, vault ready, and record statistics');
  } catch (e: any) {
    fail('Readiness check failed', e);
  }

  // 2. Test USERNAME_NOT_FOUND
  try {
    const nonExistentUsername = `nonexistent_user_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: nonExistentUsername,
        password: 'AnyPassword123!',
        role: 'TEACHER'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.code, 'USERNAME_NOT_FOUND');
    assert.strictEqual(data.error, 'Username not found.');
    pass('Non-existent username returns 404 USERNAME_NOT_FOUND ("Username not found.")');
  } catch (e: any) {
    fail('USERNAME_NOT_FOUND test failed', e);
  }

  // 3. Test EMAIL_NOT_FOUND
  try {
    const nonExistentEmail = `ghost_user_${Date.now()}@notfounddomain.com`;
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: nonExistentEmail,
        password: 'AnyPassword123!',
        role: 'TEACHER'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.code, 'EMAIL_NOT_FOUND');
    assert.strictEqual(data.error, 'Email not found.');
    pass('Non-existent email returns 404 EMAIL_NOT_FOUND ("Email not found.")');
  } catch (e: any) {
    fail('EMAIL_NOT_FOUND test failed', e);
  }

  // 4. Test INVALID_PASSWORD on existing Admin account
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'WrongPasswordStrictlyTested!',
        role: 'ADMIN'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.code, 'INVALID_PASSWORD');
    assert.strictEqual(data.error, 'Incorrect password.');
    pass('Incorrect password on existing account returns 401 INVALID_PASSWORD ("Incorrect password.")');
  } catch (e: any) {
    fail('INVALID_PASSWORD test failed', e);
  }

  // 5. Test ROLE_MISMATCH: Admin trying to login under Teacher mode
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123',
        role: 'TEACHER'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.code, 'ROLE_MISMATCH');
    assert.strictEqual(data.error, 'This account belongs to an administrator. Select Administrator Login.');
    pass('Admin account logging in as TEACHER returns 403 ROLE_MISMATCH ("This account belongs to an administrator. Select Administrator Login.")');
  } catch (e: any) {
    fail('ROLE_MISMATCH (Admin as Teacher) test failed', e);
  }

  // 6. Test Registration, Leading/Trailing Spaces Password, and Pending Status
  const testEmail = `matrix_teach_${Date.now()}@pentric.edu`;
  const testUsername = `matrix_${Date.now().toString(36)}`;
  const rawSpacedPassword = '   SecretWithSpaces2026!   ';
  let teacherId = '';
  let adminToken = '';

  try {
    // Request verification code
    const codeRes = await fetch(`${BASE_URL}/api/auth/send-verification-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        username: testUsername,
        name: 'Matrix Faculty Member'
      })
    });
    const codeData = await codeRes.json();
    assert.strictEqual(codeRes.status, 200);

    const fs = await import('fs');
    const list = JSON.parse(fs.readFileSync('data/pending_verifications.json', 'utf8'));
    const match = list.find((item: any) => item && item.email === testEmail);
    assert.ok(match, 'Pending verification must exist');
    const code = match.code;

    // Signup with leading and trailing spaces in password
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Matrix Faculty Member',
        username: testUsername,
        email: testEmail,
        password: rawSpacedPassword,
        verificationCode: code,
        schoolId: 'ota_total_academy'
      })
    });
    const signupData = await signupRes.json();
    assert.strictEqual(signupRes.status, 200);
    assert.ok(signupData.user?.id);
    teacherId = signupData.user.id;
    pass('Teacher registered with password containing intentional leading and trailing spaces');

    // 7. Test ACCOUNT_PENDING_APPROVAL
    const pendingRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: rawSpacedPassword,
        role: 'TEACHER'
      })
    });
    const pendingData = await pendingRes.json();
    assert.strictEqual(pendingRes.status, 403);
    assert.strictEqual(pendingData.code, 'ACCOUNT_PENDING_APPROVAL');
    assert.strictEqual(pendingData.error, 'Your account is awaiting administrator approval.');
    pass('Unapproved faculty returns 403 ACCOUNT_PENDING_APPROVAL ("Your account is awaiting administrator approval.")');

    // 8. Test ROLE_MISMATCH: Teacher trying to login under Admin mode
    const teacherAsAdminRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: rawSpacedPassword,
        role: 'ADMIN'
      })
    });
    const teacherAsAdminData = await teacherAsAdminRes.json();
    assert.strictEqual(teacherAsAdminRes.status, 403);
    assert.strictEqual(teacherAsAdminData.code, 'ROLE_MISMATCH');
    assert.strictEqual(teacherAsAdminData.error, 'This account belongs to a teacher. Select Teacher Login.');
    pass('Teacher account logging in as ADMIN returns 403 ROLE_MISMATCH ("This account belongs to a teacher. Select Teacher Login.")');

    // 9. Administrator approves teacher
    const adminLogin = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'ADMIN' })
    });
    const adminData = await adminLogin.json();
    assert.strictEqual(adminLogin.status, 200);
    adminToken = adminData.token;

    const approveRes = await fetch(`${BASE_URL}/api/teachers/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        teacherId,
        action: 'APPROVE',
        adminName: 'Super Admin'
      })
    });
    assert.strictEqual(approveRes.status, 200);

    // 10. Login with exact spaced password succeeds
    const loginSpacedRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: rawSpacedPassword,
        role: 'TEACHER'
      })
    });
    const loginSpacedData = await loginSpacedRes.json();
    assert.strictEqual(loginSpacedRes.status, 200, `Login with exact spaces must succeed: ${JSON.stringify(loginSpacedData)}`);
    assert.ok(loginSpacedData.token, 'Token must be issued');
    pass('Login with exact untrimmed password succeeds post-approval');

    // 11. Test Universal Backdoors are REMOVED:
    // Testing universal password 'password123' against this new teacher whose password is NOT password123
    const backdoorRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: 'password123',
        role: 'TEACHER'
      })
    });
    const backdoorData = await backdoorRes.json();
    assert.strictEqual(backdoorRes.status, 401, 'Universal password123 must be rejected');
    assert.strictEqual(backdoorData.code, 'INVALID_PASSWORD');
    pass('Universal password bypass "password123" is strictly eliminated (rejected with 401 INVALID_PASSWORD)');

    // 12. Test Rejected Account Status: ACCOUNT_REJECTED
    const rejectRes = await fetch(`${BASE_URL}/api/teachers/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        teacherId,
        action: 'REJECT',
        reason: 'Staff identity could not be verified'
      })
    });
    assert.strictEqual(rejectRes.status, 200);

    const rejectedLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: testUsername,
        password: rawSpacedPassword,
        role: 'TEACHER'
      })
    });
    const rejectedLoginData = await rejectedLoginRes.json();
    assert.strictEqual(rejectedLoginRes.status, 403);
    assert.strictEqual(rejectedLoginData.code, 'ACCOUNT_REJECTED');
    assert.strictEqual(rejectedLoginData.error, 'Your teacher registration has been rejected. Contact your administrator.');
    pass('Rejected account returns 403 ACCOUNT_REJECTED ("Your teacher registration has been rejected. Contact your administrator.")');

  } catch (e: any) {
    fail('Teacher lifecycle and security tests failed', e);
  }

  // 13. Test Rate Limiting (RATE_LIMITED)
  try {
    const rateLimitTestUser = `rate_test_${Date.now()}`;
    let rateLimited = false;
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: rateLimitTestUser,
          password: 'WrongPassword123!',
          role: 'TEACHER'
        })
      });
      if (res.status === 429) {
        const data = await res.json();
        assert.strictEqual(data.code, 'RATE_LIMITED');
        assert.strictEqual(data.error, 'Too many attempts. Please wait before trying again.');
        rateLimited = true;
        break;
      }
    }
    assert.ok(rateLimited, 'Rate limit must trigger after rapid failed attempts');
    pass('Sliding window rate limit returns 429 RATE_LIMITED ("Too many attempts. Please wait before trying again.")');
  } catch (e: any) {
    fail('Rate limit test failed', e);
  } finally {
    if (adminToken && teacherId) {
      try {
        await fetch(`${BASE_URL}/api/teachers/${teacherId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${adminToken}` }
        });
      } catch {}
    }
  }

  console.log('\n=====================================================');
  console.log(`AUTH MATRIX TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthMatrixTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
