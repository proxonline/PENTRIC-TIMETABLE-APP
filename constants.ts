
import { Subject, Class } from './types';

// --- Subjects ---

export const JSS_SUBJECTS: Subject[] = [
  { id: 'math_jss', name: 'Mathematics', category: 'JSS', isCore: true, defaultPeriodCount: 5 },
  { id: 'eng_jss', name: 'English', category: 'JSS', isCore: true, defaultPeriodCount: 5 },
  { id: 'ins_jss', name: 'INS', category: 'JSS', isCore: true, defaultPeriodCount: 3 },
  { id: 'lvf_jss', name: 'LVF', category: 'JSS', isCore: true, defaultPeriodCount: 3 },
  { id: 'scs_jss', name: 'SCS', category: 'JSS', isCore: true, defaultPeriodCount: 3 },
  { id: 'dgt_jss', name: 'DGT', category: 'JSS', isCore: true, defaultPeriodCount: 2 },
  { id: 'phe_jss', name: 'PHE', category: 'JSS', isCore: true, defaultPeriodCount: 2 },
  { id: 'bus_jss', name: 'Business Studies', category: 'JSS', isCore: true, defaultPeriodCount: 3 },
  { id: 'yor_jss', name: 'Yoruba', category: 'JSS', isCore: false, defaultPeriodCount: 2 },
  { id: 'nat_jss', name: 'National Values', category: 'JSS', isCore: false, defaultPeriodCount: 2 },
  { id: 'fre_jss', name: 'French', category: 'JSS', isCore: false, defaultPeriodCount: 1 },
  { id: 'rel_jss', name: 'IRS / CRS', category: 'JSS', isCore: false, defaultPeriodCount: 2 },
  { id: 'his_jss', name: 'History', category: 'JSS', isCore: false, defaultPeriodCount: 1 },
  { id: 'ara_jss', name: 'Arabic', category: 'JSS', isCore: false, defaultPeriodCount: 1 },
  { id: 'cca_jss', name: 'CCA', category: 'JSS', isCore: false, defaultPeriodCount: 1 },
];

export const SSS_SCIENCE_SUBJECTS: Subject[] = [
  { id: 'math_sci', name: 'Mathematics', category: 'SSS_SCIENCE', isCore: true, defaultPeriodCount: 5 },
  { id: 'eng_sci', name: 'English', category: 'SSS_SCIENCE', isCore: true, defaultPeriodCount: 5 },
  { id: 'phy_sci', name: 'Physics', category: 'SSS_SCIENCE', isCore: true, defaultPeriodCount: 5 },
  { id: 'chem_sci', name: 'Chemistry', category: 'SSS_SCIENCE', isCore: true, defaultPeriodCount: 5 },
  { id: 'bio_sci', name: 'Biology', category: 'SSS_SCIENCE', isCore: true, defaultPeriodCount: 5 },
  { id: 'fur_sci', name: 'Further Maths / Agric', category: 'SSS_SCIENCE', isCore: false, defaultPeriodCount: 5 },
  { id: 'geo_sci', name: 'Geography', category: 'SSS_SCIENCE', isCore: false, defaultPeriodCount: 3 },
  { id: 'td_sci', name: 'Technical Drawing', category: 'SSS_SCIENCE', isCore: false, defaultPeriodCount: 2 },
  { id: 'civ_sci', name: 'Civic Education', category: 'SSS_SCIENCE', isCore: false, defaultPeriodCount: 2 },
];

export const SSS_BC_SUBJECTS: Subject[] = [
  { id: 'math_bc', name: 'Mathematics', category: 'SSS_BC', isCore: true, defaultPeriodCount: 5 },
  { id: 'eng_bc', name: 'English', category: 'SSS_BC', isCore: true, defaultPeriodCount: 5 },
  { id: 'lit_bc', name: 'Literature in English', category: 'SSS_BC', isCore: true, defaultPeriodCount: 4 },
  { id: 'eco_bc', name: 'Economics', category: 'SSS_BC', isCore: true, defaultPeriodCount: 4 },
  { id: 'acc_bc', name: 'Accounting', category: 'SSS_BC', isCore: true, defaultPeriodCount: 4 },
  { id: 'dgt_bc', name: 'DGT', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'civ_bc', name: 'Civic Education', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'str_bc', name: 'Store Management', category: 'SSS_BC', isCore: false, defaultPeriodCount: 1 },
  { id: 'bk_bc', name: 'Book Keeping', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'yor_bc', name: 'Yoruba', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'rel_bc', name: 'IRS / CRS', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'gov_bc', name: 'Government', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
  { id: 'com_bc', name: 'Commerce', category: 'SSS_BC', isCore: false, defaultPeriodCount: 2 },
];

// Subjects where multiple teachers are assigned simultaneously to split the class
export const PARALLEL_SUBJECTS = ['rel_jss', 'rel_bc', 'fur_sci'];

export const ALL_SUBJECTS = [...JSS_SUBJECTS, ...SSS_SCIENCE_SUBJECTS, ...SSS_BC_SUBJECTS];

// --- Classes ---

const jssClasses = [
  'JS1A', 'JS1B', 'JS1C', 'JS1D',
  'JS2A', 'JS2B', 'JS2C', 'JS2D',
  'JS3A', 'JS3B', 'JS3C'
].map(name => ({ id: name, name, category: 'JSS' as const }));

const sssSciClasses = [
  'SS1A1', 'SS1A2', 'SS1A3', 'SS1A4',
  'SS2A1', 'SS2A2', 'SS2A3', 'SS2A4',
  'SS3A1', 'SS3A2'
].map(name => ({ id: name, name, category: 'SSS_SCIENCE' as const }));

const sssBcClasses = [
  'SS1BC', 'SS2BC', 'SS3BC'
].map(name => ({ id: name, name, category: 'SSS_BC' as const }));

export const ALL_CLASSES: Class[] = [...jssClasses, ...sssSciClasses, ...sssBcClasses];

// --- Time Structure ---

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const PERIODS = [
  { index: 0, label: 'P1', time: '8:05 – 8:45' },
  { index: 1, label: 'P2', time: '8:45 – 9:25' },
  { index: 2, label: 'P3', time: '9:25 – 10:05' },
  { index: 3, label: 'P4', time: '10:05 – 10:45' },
  // Short Break (15 mins)
  { index: 4, label: 'P5', time: '11:00 – 11:40' },
  { index: 5, label: 'P6', time: '11:40 – 12:20' },
  { index: 6, label: 'P7', time: '12:20 – 1:00' },
  // Long Break (30 mins)
  { index: 7, label: 'P8', time: '1:30 – 2:10' },
];

export const BREAK_INDICES = [4, 7]; // Indices BEFORE which breaks occur (Logic handled in UI)
