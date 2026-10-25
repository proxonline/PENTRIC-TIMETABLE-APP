
import { Subject, Class } from './types';

// --- Subjects ---

export const JSS_SUBJECTS: Subject[] = [
  { id: 'math_jss', name: 'Mathematics', code: 'MATH', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'eng_jss', name: 'English', code: 'ENGL', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'ins_jss', name: 'INS', code: 'INS', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'lvf_jss', name: 'LVF', code: 'LVF', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'scs_jss', name: 'SCS', code: 'SCS', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'bus_jss', name: 'Business Studies', code: 'BUSI', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'dgt_jss', name: 'DGT', code: 'DGT', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'phe_jss', name: 'PHE', code: 'PHE', category: 'JSS', level: 'JUNIOR', isCore: true, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'yor_jss', name: 'Yoruba', code: 'YORU', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'nat_jss', name: 'National Values', code: 'NATI', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'rel_jss', name: 'IRS / CRS', code: 'IRS', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'fre_jss', name: 'French', code: 'FREN', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'cca_jss', name: 'CCA', code: 'CCA', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'his_jss', name: 'History', code: 'HIST', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 1, periodsPerWeek: 1, maxPerDay: 1 },
  { id: 'ara_jss', name: 'Arabic', code: 'ARAB', category: 'JSS', level: 'JUNIOR', isCore: false, defaultPeriodCount: 1, periodsPerWeek: 1, maxPerDay: 1 },
];

export const SSS_SCIENCE_SUBJECTS: Subject[] = [
  { id: 'math_sci', name: 'Mathematics', code: 'MATH', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'eng_sci', name: 'English', code: 'ENGL', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'civ_sci', name: 'Civic Education', code: 'CIVI', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'phy_sci', name: 'Physics', code: 'PHYS', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'chem_sci', name: 'Chemistry', code: 'CHEM', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'bio_sci', name: 'Biology', code: 'BIOL', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'fur_sci', name: 'Further Maths / Agric', code: 'FURT', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: false, defaultPeriodCount: 4, periodsPerWeek: 4, maxPerDay: 1 },
  { id: 'td_sci', name: 'Technical Drawing', code: 'TECH', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: false, defaultPeriodCount: 4, periodsPerWeek: 4, maxPerDay: 1 },
  { id: 'dgt_sci', name: 'DGT', code: 'DGT', category: 'SSS_SCIENCE', level: 'SENIOR', stream: 'SCIENCE', isCore: false, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
];

export const SSS_BC_SUBJECTS: Subject[] = [
  { id: 'math_bc', name: 'Mathematics', code: 'MATH', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'eng_bc', name: 'English', code: 'ENGL', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 5, periodsPerWeek: 5, maxPerDay: 2 },
  { id: 'civ_bc', name: 'Civic Education', code: 'CIVI', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'lit_bc', name: 'Literature in English', code: 'LITE', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 4, periodsPerWeek: 4, maxPerDay: 2 },
  { id: 'eco_bc', name: 'Economics', code: 'ECON', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 4, periodsPerWeek: 4, maxPerDay: 2 },
  { id: 'acc_bc', name: 'Accounting', code: 'ACCO', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: true, defaultPeriodCount: 4, periodsPerWeek: 4, maxPerDay: 2 },
  { id: 'com_bc', name: 'Commerce', code: 'COMM', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'gov_bc', name: 'Government', code: 'GOVE', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 3, periodsPerWeek: 3, maxPerDay: 1 },
  { id: 'dgt_bc', name: 'DGT', code: 'DGT', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'str_bc', name: 'Store Management', code: 'STOR', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'bk_bc', name: 'Book Keeping', code: 'BOOK', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
  { id: 'yor_bc', name: 'Yoruba', code: 'YORU', category: 'SSS_BC', level: 'SENIOR', stream: 'BC', isCore: false, defaultPeriodCount: 2, periodsPerWeek: 2, maxPerDay: 1 },
];

// Subjects where multiple teachers are assigned simultaneously to split the class
export const PARALLEL_SUBJECTS = ['rel_jss', 'rel_bc', 'fur_sci'];

export const ALL_SUBJECTS = [...JSS_SUBJECTS, ...SSS_SCIENCE_SUBJECTS, ...SSS_BC_SUBJECTS];

// --- Classes ---

const jssClasses = [
  'JS1A', 'JS1B', 'JS1C', 'JS1D',
  'JS2A', 'JS2B', 'JS2C', 'JS2D',
  'JS3A', 'JS3B', 'JS3C'
].map(name => ({ id: name, name, category: 'JSS' as const, level: 'JUNIOR' as const, stream: 'GENERAL' as const }));

const sssSciClasses = [
  'SS1A1', 'SS1A2', 'SS1A3', 'SS1A4',
  'SS2A1', 'SS2A2', 'SS2A3', 'SS2A4',
  'SS3A1', 'SS3A2'
].map(name => ({ id: name, name, category: 'SSS_SCIENCE' as const, level: 'SENIOR' as const, stream: 'SCIENCE' as const }));

const sssBcClasses = [
  'SS1BC', 'SS2BC', 'SS3BC'
].map(name => ({ id: name, name, category: 'SSS_BC' as const, level: 'SENIOR' as const, stream: 'BC' as const }));

export const ALL_CLASSES: Class[] = [...jssClasses, ...sssSciClasses, ...sssBcClasses];

// --- Time Structure ---

export const TIMETABLE_CONFIG = {
  DAYS_COUNT: 5,
  PERIODS_PER_DAY: 8,
  WORSHIP_DAY: 4, // Friday (0-indexed: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4)
  WORSHIP_START_PERIOD: 6, // Index 6 (P7)
  WORSHIP_PERIODS_COUNT: 2, // P7 & P8
  TOTAL_GRID_SLOTS: 40,
  INSTRUCTIONAL_SLOTS: 38 // 40 - 2
} as const;

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

