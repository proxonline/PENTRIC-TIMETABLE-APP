import fs from 'fs';
import { ALL_CLASSES, ALL_SUBJECTS } from '../constants';
import { generateTimetable, validateTimetable } from '../services/generator';
import { syncOtaStoreDocToFirestore } from '../services/firebaseAdmin';

async function remediate() {
  console.log('--- REMEDIATING STORED TIMETABLE ---');

  let store: any = { keys: {}, timestamp: Date.now() };
  if (fs.existsSync('data/ota_store.json')) {
    try {
      store = JSON.parse(fs.readFileSync('data/ota_store.json', 'utf8'));
    } catch {}
  }

  const classes = store?.keys?.ota_classes || ALL_CLASSES;
  const subjects = store?.keys?.ota_subjects_v2 || ALL_SUBJECTS;
  const teachers = store?.keys?.ota_teachers_v3 || [];

  console.log(`Classes: ${classes.length}, Subjects: ${subjects.length}, Teachers: ${teachers.length}`);

  const genResult = await generateTimetable(
    teachers,
    classes,
    subjects,
    'BALANCED',
    (p, l) => console.log(`[Progress ${p}%] ${l.message}`),
    { maxConsecutiveTeacherPeriods: 2, classLayoutOnly: teachers.length === 0 } as any
  );

  console.log(`Generation Success: ${genResult.success}`);
  const val = validateTimetable(genResult.timetable, classes, subjects, teachers, teachers.length === 0);
  console.log(`Validation: Valid=${val.valid}, AllComplete=${val.allClassesComplete}, Errors=${val.errors.length}`);

  if (!val.allClassesComplete) {
    console.error('ERROR: Could not produce 100% complete timetable across all classes!');
    process.exit(1);
  }

  // Persist into store
  store.keys.ota_timetable_v2 = genResult.timetable;
  store.keys.ota_timetable_published_v2 = genResult.timetable;
  store.keys.ota_timetable_metadata_v2 = {
    revision: (store.keys?.ota_timetable_metadata_v2?.revision || 10) + 1,
    publishedAt: Date.now(),
    publishedBy: 'system_remediation',
    totalClasses: classes.length,
    totalSlotsScheduled: 24 * 38
  };
  store.version = Date.now();
  store.timestamp = Date.now();

  fs.writeFileSync('data/ota_store.json', JSON.stringify(store, null, 2), 'utf8');
  console.log('Successfully saved complete timetable to data/ota_store.json');

  // Push to Firestore
  try {
    await syncOtaStoreDocToFirestore('app_state', {
      keys: store.keys,
      updatedAt: Date.now(),
      updatedBy: 'system_remediation'
    });
    console.log('Successfully synced remediated timetable to Firestore ota_app_store/app_state');
  } catch (e: any) {
    console.log('Firestore sync notice:', e.message);
  }

  console.log('--- REMEDIATION COMPLETE ---');
}

remediate().catch(err => {
  console.error('Remediation error:', err);
  process.exit(1);
});
