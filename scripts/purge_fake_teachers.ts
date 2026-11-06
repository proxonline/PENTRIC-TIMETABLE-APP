import fs from 'fs';
import { syncOtaStoreDocToFirestore } from '../services/firebaseAdmin';

async function purge() {
  console.log('Purging test teachers from data/ota_store.json and Firestore...');
  if (!fs.existsSync('data/ota_store.json')) return;

  const store = JSON.parse(fs.readFileSync('data/ota_store.json', 'utf8'));
  const teachers = store?.keys?.ota_teachers_v3 || [];
  const initialCount = teachers.length;

  const isTestTeacher = (t: any) => {
    if (!t) return false;
    const name = (t.name || '').toLowerCase();
    const uname = (t.username || '').toLowerCase();
    const email = (t.contactEmail || t.email || '').toLowerCase();
    if (uname === 'qq' || name === 'qq') return true;
    if (uname.startsWith('sync_') || uname.startsWith('matrix_')) return true;
    if (email.includes('sync_teach_') || email.includes('matrix_teach_')) return true;
    if (name.includes('alan turing') || name.includes('matrix faculty')) return true;
    return false;
  };

  const filteredTeachers = teachers.filter((t: any) => !isTestTeacher(t));
  console.log(`Teachers: ${initialCount} -> ${filteredTeachers.length}`);

  store.keys.ota_teachers_v3 = filteredTeachers;
  store.keys.ota_pending_verifications_v1 = [];
  store.version = Date.now();
  store.timestamp = Date.now();

  fs.writeFileSync('data/ota_store.json', JSON.stringify(store, null, 2), 'utf8');

  // Push to Firestore
  try {
    await syncOtaStoreDocToFirestore('ota_teachers_v3', filteredTeachers);
    await syncOtaStoreDocToFirestore('ota_pending_verifications_v1', []);
    await syncOtaStoreDocToFirestore('app_state', {
      keys: store.keys,
      updatedAt: Date.now(),
      updatedBy: 'system_purge'
    });
    console.log('Successfully purged from Firestore!');
  } catch (e: any) {
    console.error('Firestore purge notice:', e.message);
  }
}

purge().catch(console.error);
