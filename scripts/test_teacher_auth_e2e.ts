import { clientDb } from '../services/firebaseAdmin';
import { doc, getDoc } from 'firebase/firestore';

async function runTeacherAuthE2ETest() {
  console.log('=====================================================');
  console.log('PENTRIC TEACHER AUTHENTICATION & MULTI-DEVICE SYNC E2E');
  console.log('=====================================================');

  const BASE_URL = 'http://localhost:3000';
  const testEmail = `teacher_${Date.now()}@school.edu`;
  const testUsername = `teach_${Date.now().toString(36)}`;
  const testPassword = 'SecureStaffPassword2026!';
  const testName = 'Dr. Sarah Connor';

  // 1. Request 6-digit verification code
  console.log('1. Requesting verification code for', testEmail);
  const sendRes = await fetch(`${BASE_URL}/api/auth/send-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, username: testUsername, name: testName })
  });
  const sendData = await sendRes.json();
  if (!sendRes.ok) {
    throw new Error(`Failed to send code: ${JSON.stringify(sendData)}`);
  }
  console.log('  ✓ PASS: Verification code dispatched:', sendData.message);

  // Read code from pending verifications in Firestore or server file
  let code = '';
  try {
    const snap = await getDoc(doc(clientDb, 'ota_app_store', 'ota_pending_verifications_v1'));
    if (snap.exists() && Array.isArray(snap.data()?.payload)) {
      const match = snap.data().payload.find((item: any) => item && item.email === testEmail);
      if (match) code = match.code;
    }
  } catch {}

  if (!code) {
    // Read from data/pending_verifications.json
    const fs = await import('fs');
    const list = JSON.parse(fs.readFileSync('data/pending_verifications.json', 'utf8'));
    const match = list.find((item: any) => item && item.email === testEmail);
    if (match) code = match.code;
  }

  if (!code) throw new Error('Could not locate generated verification code for test');
  console.log('  ✓ PASS: Found active verification code for test:', code);

  // 2. Complete teacher registration
  console.log('2. Completing teacher registration');
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
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
  if (!signupRes.ok || !signupData.success) {
    throw new Error(`Signup failed: ${JSON.stringify(signupData)}`);
  }
  console.log('  ✓ PASS: Teacher registered with pending status. ID:', signupData.user.id);
  const teacherId = signupData.user.id;

  // 3. Verify teacher appears in Firestore ota_teachers_v3 with NO plain password
  console.log('3. Verifying Firestore shared record');
  const teachersSnap = await getDoc(doc(clientDb, 'ota_app_store', 'ota_teachers_v3'));
  if (!teachersSnap.exists()) throw new Error('Firestore ota_teachers_v3 document does not exist!');
  const remoteTeachers = teachersSnap.data().payload;
  const matchInCloud = remoteTeachers.find((t: any) => t && t.id === teacherId);
  if (!matchInCloud) throw new Error('Newly registered teacher was NOT found in Firestore ota_teachers_v3!');
  if (matchInCloud.password) throw new Error('SECURITY VIOLATION: Password hash or plaintext leaked into shared Firestore document!');
  if (matchInCloud.contactEmail !== testEmail) throw new Error('Email was not preserved in Firestore teacher profile!');
  console.log('  ✓ PASS: Teacher exists in shared Firestore without password leakage. Email preserved:', matchInCloud.contactEmail);

  // 4. Test login attempt BEFORE administrator approval (must return 403 pending)
  console.log('4. Testing login before administrator approval');
  const preApprovalLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testEmail, password: testPassword, role: 'TEACHER' })
  });
  const preApprovalData = await preApprovalLogin.json();
  if (preApprovalLogin.status !== 403 || !preApprovalData.isPendingApproval) {
    throw new Error(`Expected 403 isPendingApproval, got: ${preApprovalLogin.status} ${JSON.stringify(preApprovalData)}`);
  }
  console.log('  ✓ PASS: Pre-approval login correctly returned 403 with anti-imposter pending message');

  // 5. Admin approves teacher
  console.log('5. Administrator approves teacher');
  const adminLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', role: 'ADMIN' })
  });
  const adminData = await adminLogin.json();
  if (!adminData.token) throw new Error('Admin login failed');

  const approveRes = await fetch(`${BASE_URL}/api/teachers/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminData.token}`
    },
    body: JSON.stringify({ teacherId, action: 'APPROVE', adminName: 'Super Admin' })
  });
  const approveData = await approveRes.json();
  if (!approveRes.ok || !approveData.success) {
    throw new Error(`Teacher approval failed: ${JSON.stringify(approveData)}`);
  }
  console.log('  ✓ PASS: Administrator successfully approved faculty member');

  // 6. Test login attempt AFTER approval using email
  console.log('6. Testing post-approval login using EMAIL');
  const postApprovalLoginEmail = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testEmail, password: testPassword, role: 'TEACHER' })
  });
  const postApprovalDataEmail = await postApprovalLoginEmail.json();
  if (!postApprovalLoginEmail.ok || !postApprovalDataEmail.token) {
    throw new Error(`Login with email failed: ${JSON.stringify(postApprovalDataEmail)}`);
  }
  console.log('  ✓ PASS: Teacher authenticated successfully via EMAIL. Token received.');

  // 7. Test login attempt AFTER approval using USERNAME
  console.log('7. Testing post-approval login using USERNAME');
  const postApprovalLoginUsername = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testUsername, password: testPassword, role: 'TEACHER' })
  });
  const postApprovalDataUsername = await postApprovalLoginUsername.json();
  if (!postApprovalLoginUsername.ok || !postApprovalDataUsername.token) {
    throw new Error(`Login with username failed: ${JSON.stringify(postApprovalDataUsername)}`);
  }
  console.log('  ✓ PASS: Teacher authenticated successfully via USERNAME. Token received.');

  // 8. Test duplicate registration prevention
  console.log('8. Testing duplicate registration rejection');
  const dupRes = await fetch(`${BASE_URL}/api/auth/send-verification-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, username: 'another_user', name: 'Another Name' })
  });
  const dupData = await dupRes.json();
  if (dupRes.status !== 400 || !dupData.error?.includes('already exists')) {
    throw new Error(`Expected duplicate email error, got: ${dupRes.status} ${JSON.stringify(dupData)}`);
  }
  console.log('  ✓ PASS: Duplicate registration attempt rejected with friendly login prompt');

  console.log('=====================================================');
  console.log('ALL TEACHER AUTHENTICATION & MULTI-DEVICE TESTS PASSED');
  console.log('=====================================================');
  process.exit(0);
}

runTeacherAuthE2ETest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
