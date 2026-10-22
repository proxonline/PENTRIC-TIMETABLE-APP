import { Class, Subject, AcademicLevel } from '../types';

/**
 * Normalizes subject stream identifier
 */
export function getSubjectStream(subject: Subject): 'SCIENCE' | 'BC' | 'ALL' {
  if (subject.stream) return subject.stream;

  const category = (subject.category || '').toUpperCase();
  if (category === 'SSS_SCIENCE') {
    // Check if it's one of the common subjects
    const code = (subject.code || subject.name || '').toUpperCase();
    if (code.includes('MATH') || code.includes('ENGL') || code.includes('CIVI')) {
      return 'ALL';
    }
    return 'SCIENCE';
  }
  if (category === 'SSS_BC') {
    const code = (subject.code || subject.name || '').toUpperCase();
    if (code.includes('MATH') || code.includes('ENGL') || code.includes('CIVI')) {
      return 'ALL';
    }
    return 'BC';
  }

  // Check code/name patterns for SS subjects
  const code = (subject.code || subject.id || subject.name || '').toUpperCase();
  const name = (subject.name || '').toUpperCase();

  // Common SS subjects
  if (code.startsWith('MATH') || code.startsWith('MTH') || name.includes('MATHEMATICS') ||
      code.startsWith('ENGL') || code.startsWith('ENG') || name.includes('ENGLISH') ||
      code.startsWith('CIVI') || code.startsWith('CIV') || name.includes('CIVIC')) {
    return 'ALL';
  }

  // Science stream subjects
  if (code.startsWith('PHYS') || code.startsWith('PHY') || name.includes('PHYSICS') ||
      code.startsWith('CHEM') || code.startsWith('CHM') || name.includes('CHEMISTRY') ||
      code.startsWith('BIOL') || code.startsWith('BIO') || name.includes('BIOLOGY') ||
      code.startsWith('FURT') || code.startsWith('FUR') || name.includes('FURTHER MATH') ||
      code.startsWith('TECH') || code.startsWith('TD') || name.includes('TECHNICAL DRAWING')) {
    return 'SCIENCE';
  }

  // BC stream subjects
  if (code.startsWith('LITE') || code.startsWith('LIT') || name.includes('LITERATURE') ||
      code.startsWith('ECON') || code.startsWith('ECO') || name.includes('ECONOMICS') ||
      code.startsWith('ACCO') || code.startsWith('ACC') || name.includes('ACCOUNTING') ||
      code.startsWith('DGT') || name.includes('DGT') ||
      code.startsWith('STOR') || code.startsWith('STR') || name.includes('STORE MANAGEMENT') ||
      code.startsWith('BOOK') || code.startsWith('BK') || name.includes('BOOK KEEPING') ||
      code.startsWith('YORU') || code.startsWith('YOR') || name.includes('YORUBA') ||
      code.startsWith('IRS') || code.startsWith('CRS') || code.startsWith('REL') || name.includes('IRS') || name.includes('CRS') ||
      code.startsWith('GOVE') || code.startsWith('GOV') || name.includes('GOVERNMENT') ||
      code.startsWith('COMM') || code.startsWith('COM') || name.includes('COMMERCE')) {
    return 'BC';
  }

  return 'ALL';
}

/**
 * Normalizes class stream identifier
 */
export function getClassStream(classObj: Class): 'SCIENCE' | 'BC' | 'GENERAL' {
  if (classObj.stream) return classObj.stream;

  const category = (classObj.category || '').toUpperCase();
  if (category === 'SSS_SCIENCE') return 'SCIENCE';
  if (category === 'SSS_BC') return 'BC';

  const id = (classObj.id || '').toUpperCase();
  const name = (classObj.name || '').toUpperCase();

  // Combined BC streams: SS1BC, SS2BC, SS3BC
  if (id.includes('BC') || name.includes('BC')) {
    return 'BC';
  }

  // A / Science streams: SS1A1, SS1A2, SS2A1, etc.
  if (/SS\d+A\d*/i.test(id) || /SS\d+A\d*/i.test(name) || id.includes('SCI') || name.includes('SCIENCE')) {
    return 'SCIENCE';
  }

  return 'GENERAL';
}

/**
 * Checks if a subject is strictly eligible for a given class.
 * Works generically across all schools while enforcing strict SS curriculum separation.
 */
export function isSubjectEligibleForClass(
  subject: Subject,
  classObj: Class,
  isOtaSchool: boolean = true
): boolean {
  // 1. Explicit exclusion: Geography (GEOG) is NOT part of the OTA Total Academy SS curriculum
  if (isOtaSchool) {
    const code = (subject.code || subject.id || subject.name || '').toUpperCase();
    const name = (subject.name || '').toUpperCase();
    if (code.startsWith('GEOG') || code.startsWith('GEO') || name.includes('GEOGRAPHY')) {
      return false;
    }
  }

  // 2. Class explicit subject whitelist (if configured)
  if (classObj.eligibleSubjectIds && classObj.eligibleSubjectIds.length > 0) {
    return classObj.eligibleSubjectIds.includes(subject.id);
  }

  // 3. Subject explicit class whitelist (if configured)
  if (subject.eligibleClassIds && subject.eligibleClassIds.length > 0) {
    return subject.eligibleClassIds.includes(classObj.id);
  }

  // 4. Academic Level Match (JUNIOR vs SENIOR)
  const classLevel: AcademicLevel = classObj.level || 
    (classObj.category === 'JSS' || classObj.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');
  const subjectLevel: AcademicLevel = subject.level || 
    (subject.category === 'JSS' || subject.category === 'JUNIOR' ? 'JUNIOR' : 'SENIOR');

  // If level does not match and subject category is not ALL, reject
  if (subject.category !== 'ALL' && classLevel !== subjectLevel) {
    return false;
  }

  // Junior classes: only accept Junior subjects or ALL
  if (classLevel === 'JUNIOR') {
    return subjectLevel === 'JUNIOR' || subject.category === 'JSS' || subject.category === 'ALL';
  }

  // 5. Senior Classes: Stream Eligibility Check
  const classStream = getClassStream(classObj); // 'SCIENCE' | 'BC' | 'GENERAL'

  // ID-based stream affiliation check
  if (subject.id.endsWith('_sci')) {
    return classStream === 'SCIENCE';
  }
  if (subject.id.endsWith('_bc')) {
    return classStream === 'BC';
  }

  // If subject has explicit stream defined by administrator:
  if (subject.stream === 'SCIENCE') {
    return classStream === 'SCIENCE';
  }
  if (subject.stream === 'BC') {
    return classStream === 'BC';
  }

  // If subject has explicit stream-specific category:
  const subCat = (subject.category || '').toUpperCase();
  if (subCat === 'SSS_SCIENCE') {
    return classStream === 'SCIENCE';
  }
  if (subCat === 'SSS_BC') {
    return classStream === 'BC';
  }

  // Fallback to normalized subStream pattern
  const subStream = getSubjectStream(subject);
  if (subStream === 'SCIENCE') {
    return classStream === 'SCIENCE';
  }
  if (subStream === 'BC') {
    return classStream === 'BC';
  }

  // Common subjects with stream: 'ALL' apply to both
  return true;
}

/**
 * Retrieves the exact filtered pool of subjects eligible for a given class.
 */
export function getEligibleSubjectsForClass(
  classObj: Class,
  allSubjects: Subject[],
  isOtaSchool: boolean = true
): Subject[] {
  return allSubjects.filter(sub => isSubjectEligibleForClass(sub, classObj, isOtaSchool));
}
