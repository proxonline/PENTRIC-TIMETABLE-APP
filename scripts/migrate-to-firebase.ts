import fs from 'fs';
import path from 'path';
import { db, doc, setDoc } from '../services/firebase';

async function migrateData() {
  console.log('--- Starting One-Time Data Migration to Firebase Firestore ---');

  const DATA_FILE = path.join(process.cwd(), 'data', 'ota_store.json');
  let storeKeys: Record<string, any> = {};

  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      storeKeys = parsed.keys || {};
      console.log(`Loaded store from ${DATA_FILE}`);
    } catch (err) {
      console.error('Failed to parse local store file:', err);
    }
  } else {
    console.log('No local data/ota_store.json found.');
  }

  const keysToMigrate = Object.keys(storeKeys);
  if (keysToMigrate.length === 0) {
    console.log('No store keys found in file to migrate.');
    process.exit(0);
  }

  const summary: Record<string, number> = {};

  for (const key of keysToMigrate) {
    const val = storeKeys[key];
    if (val !== undefined && val !== null) {
      await setDoc(doc(db, 'ota_app_store', key), {
        payload: val,
        updatedAt: Date.now()
      });

      let count = 0;
      if (Array.isArray(val)) {
        count = val.length;
      } else if (typeof val === 'object') {
        count = Object.keys(val).length;
      } else {
        count = 1;
      }
      summary[key] = count;
      console.log(`[SUCCESS] Migrated '${key}' -> ${count} record(s)`);
    }
  }

  console.log('\n================ MIGRATION SUMMARY ================');
  console.table(summary);
  console.log('===================================================\n');

  process.exit(0);
}

migrateData().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
