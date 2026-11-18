import { TeacherThemeId } from '../types';

export interface TeacherThemeConfig {
  id: TeacherThemeId;
  name: string;
  tagline: string;
  isDark: boolean;
  timetableVariant: 'light' | 'dark_purple' | 'dark_cyan';
  swatchGradient: string;
  swatchRing: string;
  // Layout & Ambient Canvas
  appShell: string;
  orb1: string;
  orb2: string;
  orb3: string;
  orb4: string;
  // Sidebar & Header
  sidebar: string;
  sidebarHeader: string;
  sidebarFooter: string;
  sidebarDivider: string;
  brandBadge: string;
  brandSubtext: string;
  navActive: string;
  navInactive: string;
  navIconInactive: string;
  navBadgeInactive: string;
  navBadgeActive: string;
  profileMiniCard: string;
  profileMiniAvatar: string;
  profileMiniMeta: string;
  logoutBtn: string;
  header: string;
  headerBreadcrumb: string;
  // Glass Cards & Surfaces
  heroCard: string;
  heroGlow: string;
  glassCard: string;
  glassCardHover: string;
  cardHeader: string;
  softInset: string;
  divider: string;
  // Typography
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textAccent: string;
  // Buttons & Icons
  primaryBtn: string;
  secondaryBtn: string;
  iconBtn: string;
  accentBadge: string;
  // Charts & Bars
  barTrack: string;
  barFill: string;
  // Inputs & Forms
  input: string;
  selectOption: string;
  // Onboarding & Modals
  modalBackdrop: string;
  modalPanel: string;
  modalHeader: string;
  onboardingSidebar: string;
  onboardingContainer: string;
  subjectSelectedCard: string;
  subjectUnselectedCard: string;
  // Status & Messages
  chatMeBubble: string;
  chatOtherBubble: string;
  chatRoomBg: string;
  unreadMessageCard: string;
  readMessageCard: string;
  profileBanner: string;
  profileAvatarBorder: string;
}

export const TEACHER_THEMES: Record<TeacherThemeId, TeacherThemeConfig> = {
  obsidian_purple: {
    id: 'obsidian_purple',
    name: 'Obsidian Violet',
    tagline: 'Midnight black · Royal purple glass',
    isDark: true,
    timetableVariant: 'dark_purple',
    swatchGradient: 'from-[#07040F] via-[#5B21B6] to-[#A855F7]',
    swatchRing: 'ring-violet-400',
    appShell: 'bg-gradient-to-br from-[#040308] via-[#0B0617] to-[#15092D] text-slate-50',
    orb1: 'bg-gradient-to-br from-violet-600/35 via-purple-600/25 to-transparent',
    orb2: 'bg-gradient-to-bl from-fuchsia-600/25 via-purple-500/25 to-indigo-700/15',
    orb3: 'bg-gradient-to-tr from-indigo-600/25 via-violet-500/20 to-transparent',
    orb4: 'bg-gradient-to-tl from-purple-700/30 via-fuchsia-500/20 to-transparent',
    sidebar:
      'bg-gradient-to-b from-[#0C0817]/88 via-[#0A0614]/84 to-[#130A26]/88 backdrop-blur-2xl text-slate-50 border-r border-purple-400/20 shadow-[8px_0_40px_-10px_rgba(139,92,246,0.35)]',
    sidebarHeader:
      'border-b border-purple-400/20 bg-gradient-to-r from-[#130B24]/80 to-[#1C0E35]/70',
    sidebarFooter:
      'border-t border-purple-400/20 bg-gradient-to-t from-[#120922]/85 to-[#0C0718]/75 backdrop-blur-md',
    sidebarDivider: 'border-t border-purple-400/20',
    brandBadge:
      'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-600/40',
    brandSubtext: 'text-purple-300/85',
    navActive:
      'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 text-white shadow-[0_10px_26px_-6px_rgba(139,92,246,0.6)] border border-purple-300/30',
    navInactive:
      'text-purple-100/80 hover:bg-purple-500/15 hover:text-white border border-transparent hover:border-purple-400/25',
    navIconInactive: 'text-violet-400',
    navBadgeInactive: 'bg-purple-500/20 text-purple-200 border border-purple-400/30',
    navBadgeActive: 'bg-white/20 text-white',
    profileMiniCard:
      'bg-[#160E2B]/80 hover:bg-[#1E1338]/90 border border-purple-400/25 ring-1 ring-purple-500/25 hover:ring-violet-400/50 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm shadow-purple-600/35',
    profileMiniMeta: 'text-purple-300/85',
    logoutBtn:
      'bg-[#1A0D24]/80 border border-rose-400/30 text-rose-300 hover:bg-rose-500/20 hover:text-rose-200',
    header:
      'bg-[#0A0614]/72 backdrop-blur-2xl border-b border-purple-400/20 shadow-[0_8px_28px_-12px_rgba(124,58,237,0.35)]',
    headerBreadcrumb: 'text-purple-300/80',
    heroCard:
      'bg-gradient-to-br from-[#160E2B]/90 via-[#120A23]/84 to-[#241147]/85 backdrop-blur-2xl rounded-xl border border-purple-300/25 ring-1 ring-violet-500/30 shadow-[0_22px_54px_-16px_rgba(139,92,246,0.45),inset_0_1px_0_rgba(233,213,255,0.2)]',
    heroGlow: 'bg-gradient-to-bl from-violet-500/30 via-fuchsia-500/20 to-transparent',
    glassCard:
      'bg-gradient-to-br from-[#130C24]/82 via-[#0F091D]/78 to-[#1B1033]/78 backdrop-blur-2xl rounded-xl border border-purple-300/20 ring-1 ring-purple-500/25 shadow-[0_16px_42px_-14px_rgba(124,58,237,0.36),inset_0_1px_0_rgba(216,180,254,0.14)]',
    glassCardHover:
      'hover:from-[#1B1133]/90 hover:to-[#241442]/88 hover:ring-violet-400/55',
    cardHeader:
      'border-b border-purple-400/20 bg-gradient-to-r from-[#1A1030]/85 via-[#21133D]/75 to-[#170E2B]/85',
    softInset: 'bg-[#1A1130]/75 border border-purple-400/25',
    divider: 'divide-y divide-purple-400/15',
    textPrimary: 'text-slate-50',
    textSecondary: 'text-purple-100/85',
    textMuted: 'text-purple-300/75',
    textAccent: 'text-violet-300',
    primaryBtn:
      'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:via-purple-500 hover:to-indigo-500 text-white shadow-[0_8px_24px_-6px_rgba(139,92,246,0.6)] border border-purple-300/30',
    secondaryBtn:
      'bg-[#1B1233]/85 backdrop-blur-md hover:bg-[#271949] text-purple-100 border border-purple-400/30 hover:border-violet-300/55 shadow-sm',
    iconBtn:
      'bg-[#18102E]/85 backdrop-blur-md border border-purple-400/30 text-purple-200 hover:text-white hover:bg-[#241645] shadow-xs',
    accentBadge: 'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white shadow-md shadow-purple-600/35',
    barTrack: 'bg-purple-950/80 border border-purple-400/20',
    barFill: 'bg-gradient-to-t from-violet-600 via-purple-500 to-fuchsia-400',
    input:
      'bg-[#0B0616]/85 border border-purple-400/30 text-slate-100 placeholder:text-purple-300/45 focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400',
    selectOption: 'bg-[#120A24] text-purple-100',
    modalBackdrop: 'bg-black/70 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-[#140D27]/96 via-[#100920]/94 to-[#1F123B]/94 backdrop-blur-2xl rounded-xl border border-purple-300/25 ring-1 ring-violet-500/35 shadow-[0_26px_70px_-14px_rgba(124,58,237,0.55)]',
    modalHeader:
      'border-b border-purple-400/20 bg-gradient-to-r from-[#191030]/95 via-[#221440]/90 to-[#170E2B]/95',
    onboardingSidebar:
      'bg-gradient-to-b from-[#0E081D]/92 via-[#110A24]/88 to-[#1B0F36]/90 text-slate-50 border-r border-purple-400/20',
    onboardingContainer:
      'bg-[#100A20]/90 backdrop-blur-2xl border-0 sm:border border-purple-300/25 ring-1 ring-violet-500/30 shadow-[0_26px_70px_-14px_rgba(124,58,237,0.55)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-violet-600/30 to-purple-700/25 border-violet-400/70 text-white shadow-sm shadow-purple-600/25',
    subjectUnselectedCard:
      'bg-[#170F2B]/80 backdrop-blur-md hover:bg-[#221640] border-purple-400/25 hover:border-violet-400/50 text-purple-100',
    chatMeBubble:
      'bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/30',
    chatOtherBubble:
      'bg-[#1B1233]/88 backdrop-blur-md text-slate-100 border border-purple-400/25 ring-1 ring-purple-500/20 shadow-xs',
    chatRoomBg: 'bg-[#080512]/55',
    unreadMessageCard:
      'bg-gradient-to-r from-[#1D1238]/92 to-[#271649]/88 border-violet-400/60 shadow-sm',
    readMessageCard:
      'bg-[#130C24]/80 border-purple-400/20 ring-1 ring-purple-500/15 hover:bg-[#1B1132]',
    profileBanner:
      'bg-gradient-to-r from-[#140A2B] via-[#4C1D95]/75 to-[#7E22CE]/65 border-b border-purple-400/25',
    profileAvatarBorder: 'border-[#160E2B]',
  },

  white_blue: {
    id: 'white_blue',
    name: 'Frost Sky',
    tagline: 'Pure white · Ocean blue glass',
    isDark: false,
    timetableVariant: 'light',
    swatchGradient: 'from-white via-sky-200 to-blue-600',
    swatchRing: 'ring-blue-500',
    appShell: 'bg-gradient-to-br from-white via-[#EFF6FF] to-[#DBEAFE] text-slate-900',
    orb1: 'bg-gradient-to-br from-white via-sky-200/55 to-blue-300/35',
    orb2: 'bg-gradient-to-bl from-blue-400/35 via-sky-300/35 to-white/10',
    orb3: 'bg-gradient-to-tr from-sky-200/40 via-white/50 to-blue-300/30',
    orb4: 'bg-gradient-to-tl from-blue-500/25 via-sky-300/30 to-white/20',
    sidebar:
      'bg-gradient-to-b from-white/84 via-white/74 to-sky-50/82 backdrop-blur-2xl text-slate-900 border-r border-white/90 shadow-[8px_0_32px_-12px_rgba(37,99,235,0.16)]',
    sidebarHeader: 'border-b border-blue-100/80 bg-gradient-to-r from-white/70 to-sky-50/60',
    sidebarFooter: 'border-t border-blue-100/80 bg-gradient-to-t from-sky-50/75 to-white/60 backdrop-blur-md',
    sidebarDivider: 'border-t border-blue-100/80',
    brandBadge: 'bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/25',
    brandSubtext: 'text-blue-700/80',
    navActive:
      'bg-gradient-to-r from-blue-600 via-blue-600 to-sky-500 text-white shadow-[0_8px_20px_-6px_rgba(37,99,235,0.45)] border border-blue-500/30',
    navInactive:
      'text-slate-700 hover:bg-white/75 hover:text-blue-900 hover:shadow-sm border border-transparent hover:border-blue-100/80',
    navIconInactive: 'text-blue-600/75',
    navBadgeInactive: 'bg-blue-50/90 text-blue-700 border border-blue-200/80',
    navBadgeActive: 'bg-white/25 text-white',
    profileMiniCard:
      'bg-white/80 hover:bg-white border border-white ring-1 ring-blue-100/90 hover:ring-blue-300 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-sm shadow-blue-500/20',
    profileMiniMeta: 'text-blue-700/80',
    logoutBtn: 'bg-white/80 border border-rose-200/80 text-rose-700 hover:bg-rose-50',
    header:
      'bg-white/70 backdrop-blur-2xl border-b border-white/90 shadow-[0_6px_24px_-12px_rgba(37,99,235,0.16)]',
    headerBreadcrumb: 'text-blue-700/75',
    heroCard:
      'bg-gradient-to-br from-white/92 via-sky-50/82 to-blue-100/78 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-blue-300/60 shadow-[0_20px_48px_-16px_rgba(37,99,235,0.25),inset_0_1px_0_rgba(255,255,255,0.95)]',
    heroGlow: 'bg-gradient-to-bl from-blue-400/25 via-sky-300/20 to-transparent',
    glassCard:
      'bg-white/76 backdrop-blur-xl rounded-xl border border-white ring-1 ring-blue-200/55 shadow-[0_14px_38px_-14px_rgba(37,99,235,0.2),inset_0_1px_0_rgba(255,255,255,0.9)]',
    glassCardHover: 'hover:bg-white/95 hover:ring-blue-400/70',
    cardHeader: 'border-b border-blue-100/80 bg-gradient-to-r from-white/80 via-sky-50/70 to-blue-50/75',
    softInset: 'bg-gradient-to-br from-white/90 to-sky-50/90 border border-blue-100/90',
    divider: 'divide-y divide-blue-100/70',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    textAccent: 'text-blue-700',
    primaryBtn:
      'bg-gradient-to-r from-blue-600 via-blue-600 to-sky-500 hover:from-blue-700 hover:via-blue-700 hover:to-sky-600 text-white shadow-[0_8px_22px_-6px_rgba(37,99,235,0.48)] border border-blue-500/30',
    secondaryBtn:
      'bg-white/85 backdrop-blur-md hover:bg-white text-blue-900 border border-blue-200/80 hover:border-blue-300 shadow-[0_4px_14px_-6px_rgba(37,99,235,0.18)]',
    iconBtn:
      'bg-white/80 backdrop-blur-md border border-blue-200/80 text-slate-700 hover:text-blue-700 hover:bg-white shadow-xs',
    accentBadge: 'bg-gradient-to-br from-blue-600 via-blue-500 to-sky-500 text-white shadow-md shadow-blue-500/20',
    barTrack: 'bg-blue-100/80',
    barFill: 'bg-gradient-to-t from-blue-600 via-blue-500 to-sky-400',
    input:
      'bg-white/88 border border-blue-200/80 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500',
    selectOption: 'bg-white text-slate-900',
    modalBackdrop: 'bg-slate-900/45 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-white/95 via-white/90 to-sky-50/90 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-blue-200/70 shadow-2xl',
    modalHeader: 'border-b border-blue-100/80 bg-gradient-to-r from-white via-sky-50/80 to-blue-50/85',
    onboardingSidebar:
      'bg-gradient-to-b from-white/90 via-sky-50/75 to-blue-100/70 text-slate-900 border-r border-white/90',
    onboardingContainer:
      'bg-white/85 backdrop-blur-2xl border-0 sm:border border-white ring-1 ring-blue-200/60 shadow-[0_24px_60px_-15px_rgba(37,99,235,0.28)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-blue-50/95 to-sky-100/85 border-blue-400 text-blue-950 shadow-sm shadow-blue-500/15',
    subjectUnselectedCard:
      'bg-white/75 backdrop-blur-md hover:bg-white border-blue-100 hover:border-blue-300 text-slate-800',
    chatMeBubble: 'bg-gradient-to-br from-blue-600 via-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/20',
    chatOtherBubble: 'bg-white/85 backdrop-blur-md text-slate-800 border border-white ring-1 ring-blue-100/80 shadow-xs',
    chatRoomBg: 'bg-sky-50/25',
    unreadMessageCard: 'bg-gradient-to-r from-white/95 to-sky-50/90 border-blue-300 shadow-sm',
    readMessageCard: 'bg-white/80 border-white ring-1 ring-blue-100/80 hover:bg-white',
    profileBanner: 'bg-gradient-to-r from-white via-sky-100/90 to-blue-200/85 border-b border-blue-100/80',
    profileAvatarBorder: 'border-white',
  },

  midnight_cyan: {
    id: 'midnight_cyan',
    name: 'Midnight Arctic',
    tagline: 'Deep slate black · Glacial cyan glass',
    isDark: true,
    timetableVariant: 'dark_cyan',
    swatchGradient: 'from-[#030712] via-[#0E7490] to-[#22D3EE]',
    swatchRing: 'ring-cyan-400',
    appShell: 'bg-gradient-to-br from-[#020611] via-[#061322] to-[#082032] text-slate-50',
    orb1: 'bg-gradient-to-br from-cyan-500/30 via-sky-600/20 to-transparent',
    orb2: 'bg-gradient-to-bl from-teal-500/25 via-cyan-400/20 to-blue-700/15',
    orb3: 'bg-gradient-to-tr from-sky-600/20 via-cyan-400/15 to-transparent',
    orb4: 'bg-gradient-to-tl from-cyan-600/25 via-teal-400/15 to-transparent',
    sidebar:
      'bg-gradient-to-b from-[#050E1B]/90 via-[#040B16]/86 to-[#07182B]/90 backdrop-blur-2xl text-slate-50 border-r border-cyan-400/20 shadow-[8px_0_40px_-10px_rgba(6,182,212,0.28)]',
    sidebarHeader: 'border-b border-cyan-400/20 bg-gradient-to-r from-[#071527]/85 to-[#0A1F36]/75',
    sidebarFooter: 'border-t border-cyan-400/20 bg-gradient-to-t from-[#061425]/88 to-[#040D1A]/80 backdrop-blur-md',
    sidebarDivider: 'border-t border-cyan-400/20',
    brandBadge: 'bg-gradient-to-br from-cyan-500 via-sky-500 to-teal-500 text-slate-950 shadow-lg shadow-cyan-500/30',
    brandSubtext: 'text-cyan-300/85',
    navActive:
      'bg-gradient-to-r from-cyan-600 via-sky-600 to-teal-600 text-white shadow-[0_10px_24px_-6px_rgba(6,182,212,0.55)] border border-cyan-300/30',
    navInactive:
      'text-cyan-100/80 hover:bg-cyan-500/15 hover:text-white border border-transparent hover:border-cyan-400/25',
    navIconInactive: 'text-cyan-400',
    navBadgeInactive: 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30',
    navBadgeActive: 'bg-white/20 text-white',
    profileMiniCard:
      'bg-[#081728]/85 hover:bg-[#0D2138] border border-cyan-400/25 ring-1 ring-cyan-500/20 hover:ring-cyan-400/50 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-cyan-500 to-teal-500 text-slate-950 font-extrabold shadow-sm',
    profileMiniMeta: 'text-cyan-300/85',
    logoutBtn: 'bg-[#190D1D]/80 border border-rose-400/30 text-rose-300 hover:bg-rose-500/20',
    header:
      'bg-[#040B16]/75 backdrop-blur-2xl border-b border-cyan-400/20 shadow-[0_8px_28px_-12px_rgba(6,182,212,0.28)]',
    headerBreadcrumb: 'text-cyan-300/80',
    heroCard:
      'bg-gradient-to-br from-[#081628]/90 via-[#061221]/85 to-[#0C263E]/85 backdrop-blur-2xl rounded-xl border border-cyan-300/25 ring-1 ring-cyan-500/25 shadow-[0_22px_54px_-16px_rgba(6,182,212,0.35),inset_0_1px_0_rgba(165,243,252,0.16)]',
    heroGlow: 'bg-gradient-to-bl from-cyan-400/25 via-teal-400/15 to-transparent',
    glassCard:
      'bg-gradient-to-br from-[#071424]/84 via-[#050F1D]/80 to-[#0B2036]/80 backdrop-blur-2xl rounded-xl border border-cyan-300/20 ring-1 ring-cyan-500/20 shadow-[0_16px_42px_-14px_rgba(6,182,212,0.3),inset_0_1px_0_rgba(165,243,252,0.12)]',
    glassCardHover: 'hover:from-[#0B1C31]/90 hover:to-[#102944]/88 hover:ring-cyan-400/50',
    cardHeader: 'border-b border-cyan-400/20 bg-gradient-to-r from-[#091A2E]/88 via-[#0D233B]/80 to-[#081628]/88',
    softInset: 'bg-[#0A1B2E]/80 border border-cyan-400/25',
    divider: 'divide-y divide-cyan-400/15',
    textPrimary: 'text-slate-50',
    textSecondary: 'text-cyan-50/85',
    textMuted: 'text-cyan-200/70',
    textAccent: 'text-cyan-300',
    primaryBtn:
      'bg-gradient-to-r from-cyan-600 via-sky-600 to-teal-600 hover:from-cyan-500 hover:via-sky-500 hover:to-teal-500 text-white shadow-[0_8px_24px_-6px_rgba(6,182,212,0.5)] border border-cyan-300/30',
    secondaryBtn:
      'bg-[#0A1B2E]/85 backdrop-blur-md hover:bg-[#102842] text-cyan-100 border border-cyan-400/30 hover:border-cyan-300/55 shadow-sm',
    iconBtn:
      'bg-[#081728]/85 backdrop-blur-md border border-cyan-400/30 text-cyan-200 hover:text-white hover:bg-[#0E243C] shadow-xs',
    accentBadge: 'bg-gradient-to-br from-cyan-500 via-sky-500 to-teal-500 text-slate-950 font-extrabold shadow-md shadow-cyan-500/30',
    barTrack: 'bg-cyan-950/80 border border-cyan-400/20',
    barFill: 'bg-gradient-to-t from-cyan-600 via-sky-500 to-teal-300',
    input:
      'bg-[#040B16]/88 border border-cyan-400/30 text-slate-100 placeholder:text-cyan-200/45 focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400',
    selectOption: 'bg-[#061322] text-cyan-100',
    modalBackdrop: 'bg-black/70 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-[#081628]/96 via-[#061221]/94 to-[#0C253D]/94 backdrop-blur-2xl rounded-xl border border-cyan-300/25 ring-1 ring-cyan-500/30 shadow-[0_26px_70px_-14px_rgba(6,182,212,0.45)]',
    modalHeader: 'border-b border-cyan-400/20 bg-gradient-to-r from-[#0A1D33]/95 via-[#0F2742]/90 to-[#081628]/95',
    onboardingSidebar:
      'bg-gradient-to-b from-[#06101F]/94 via-[#071527]/90 to-[#0B223B]/92 text-slate-50 border-r border-cyan-400/20',
    onboardingContainer:
      'bg-[#061221]/92 backdrop-blur-2xl border-0 sm:border border-cyan-300/25 ring-1 ring-cyan-500/30 shadow-[0_26px_70px_-14px_rgba(6,182,212,0.45)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-cyan-600/30 to-teal-600/25 border-cyan-400/70 text-white shadow-sm shadow-cyan-500/25',
    subjectUnselectedCard:
      'bg-[#091829]/82 backdrop-blur-md hover:bg-[#0F253E] border-cyan-400/25 hover:border-cyan-300/50 text-cyan-50',
    chatMeBubble: 'bg-gradient-to-br from-cyan-600 via-sky-600 to-teal-600 text-white shadow-md shadow-cyan-500/25',
    chatOtherBubble: 'bg-[#0A1B2E]/90 backdrop-blur-md text-slate-100 border border-cyan-400/25 ring-1 ring-cyan-500/20 shadow-xs',
    chatRoomBg: 'bg-[#030914]/55',
    unreadMessageCard: 'bg-gradient-to-r from-[#0B2036]/94 to-[#102C48]/90 border-cyan-400/60 shadow-sm',
    readMessageCard: 'bg-[#071424]/82 border-cyan-400/20 ring-1 ring-cyan-500/15 hover:bg-[#0B1E33]',
    profileBanner: 'bg-gradient-to-r from-[#061221] via-[#0E7490]/65 to-[#0284C7]/60 border-b border-cyan-400/25',
    profileAvatarBorder: 'border-[#081628]',
  },

  lavender_mist: {
    id: 'lavender_mist',
    name: 'Lavender Pearl',
    tagline: 'Soft pearl · Royal iris glass',
    isDark: false,
    timetableVariant: 'light',
    swatchGradient: 'from-white via-purple-200 to-violet-600',
    swatchRing: 'ring-violet-500',
    appShell: 'bg-gradient-to-br from-white via-[#F5F3FF] to-[#EDE9FE] text-slate-900',
    orb1: 'bg-gradient-to-br from-white via-purple-200/55 to-violet-300/35',
    orb2: 'bg-gradient-to-bl from-violet-400/30 via-purple-300/35 to-white/10',
    orb3: 'bg-gradient-to-tr from-fuchsia-200/35 via-white/50 to-violet-300/30',
    orb4: 'bg-gradient-to-tl from-indigo-400/25 via-purple-300/30 to-white/20',
    sidebar:
      'bg-gradient-to-b from-white/86 via-white/76 to-purple-50/84 backdrop-blur-2xl text-slate-900 border-r border-white/90 shadow-[8px_0_32px_-12px_rgba(124,58,237,0.16)]',
    sidebarHeader: 'border-b border-purple-100/80 bg-gradient-to-r from-white/75 to-purple-50/65',
    sidebarFooter: 'border-t border-purple-100/80 bg-gradient-to-t from-purple-50/75 to-white/60 backdrop-blur-md',
    sidebarDivider: 'border-t border-purple-100/80',
    brandBadge: 'bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-500 text-white shadow-md shadow-violet-500/25',
    brandSubtext: 'text-violet-700/85',
    navActive:
      'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 text-white shadow-[0_8px_20px_-6px_rgba(124,58,237,0.45)] border border-violet-500/30',
    navInactive:
      'text-slate-700 hover:bg-white/80 hover:text-violet-950 hover:shadow-sm border border-transparent hover:border-purple-100',
    navIconInactive: 'text-violet-600/80',
    navBadgeInactive: 'bg-purple-50 text-violet-700 border border-purple-200/80',
    navBadgeActive: 'bg-white/25 text-white',
    profileMiniCard:
      'bg-white/85 hover:bg-white border border-white ring-1 ring-purple-100 hover:ring-violet-300 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-violet-600 to-purple-500 text-white shadow-sm',
    profileMiniMeta: 'text-violet-700/85',
    logoutBtn: 'bg-white/80 border border-rose-200/80 text-rose-700 hover:bg-rose-50',
    header:
      'bg-white/72 backdrop-blur-2xl border-b border-white/90 shadow-[0_6px_24px_-12px_rgba(124,58,237,0.15)]',
    headerBreadcrumb: 'text-violet-700/80',
    heroCard:
      'bg-gradient-to-br from-white/92 via-purple-50/82 to-violet-100/78 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-violet-300/60 shadow-[0_20px_48px_-16px_rgba(124,58,237,0.22),inset_0_1px_0_rgba(255,255,255,0.95)]',
    heroGlow: 'bg-gradient-to-bl from-violet-400/25 via-purple-300/20 to-transparent',
    glassCard:
      'bg-white/78 backdrop-blur-xl rounded-xl border border-white ring-1 ring-purple-200/60 shadow-[0_14px_38px_-14px_rgba(124,58,237,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
    glassCardHover: 'hover:bg-white/95 hover:ring-violet-400/70',
    cardHeader: 'border-b border-purple-100/80 bg-gradient-to-r from-white/82 via-purple-50/70 to-violet-50/75',
    softInset: 'bg-gradient-to-br from-white/90 to-purple-50/90 border border-purple-100',
    divider: 'divide-y divide-purple-100/70',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    textAccent: 'text-violet-700',
    primaryBtn:
      'bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 text-white shadow-[0_8px_22px_-6px_rgba(124,58,237,0.45)] border border-violet-500/30',
    secondaryBtn:
      'bg-white/85 backdrop-blur-md hover:bg-white text-violet-950 border border-purple-200/80 hover:border-violet-300 shadow-xs',
    iconBtn:
      'bg-white/82 backdrop-blur-md border border-purple-200/80 text-slate-700 hover:text-violet-700 hover:bg-white shadow-xs',
    accentBadge: 'bg-gradient-to-br from-violet-600 via-purple-500 to-indigo-500 text-white shadow-md shadow-violet-500/20',
    barTrack: 'bg-purple-100/85',
    barFill: 'bg-gradient-to-t from-violet-600 via-purple-500 to-indigo-400',
    input:
      'bg-white/88 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500',
    selectOption: 'bg-white text-slate-900',
    modalBackdrop: 'bg-slate-900/45 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-white/95 via-white/90 to-purple-50/90 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-purple-200/75 shadow-2xl',
    modalHeader: 'border-b border-purple-100/80 bg-gradient-to-r from-white via-purple-50/80 to-violet-50/85',
    onboardingSidebar:
      'bg-gradient-to-b from-white/90 via-purple-50/75 to-violet-100/70 text-slate-900 border-r border-white/90',
    onboardingContainer:
      'bg-white/85 backdrop-blur-2xl border-0 sm:border border-white ring-1 ring-purple-200/65 shadow-[0_24px_60px_-15px_rgba(124,58,237,0.26)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-purple-50/95 to-violet-100/85 border-violet-400 text-violet-950 shadow-sm',
    subjectUnselectedCard:
      'bg-white/78 backdrop-blur-md hover:bg-white border-purple-100 hover:border-violet-300 text-slate-800',
    chatMeBubble: 'bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-500 text-white shadow-md shadow-violet-500/20',
    chatOtherBubble: 'bg-white/85 backdrop-blur-md text-slate-800 border border-white ring-1 ring-purple-100 shadow-xs',
    chatRoomBg: 'bg-purple-50/30',
    unreadMessageCard: 'bg-gradient-to-r from-white/95 to-purple-50/90 border-violet-300 shadow-sm',
    readMessageCard: 'bg-white/80 border-white ring-1 ring-purple-100 hover:bg-white',
    profileBanner: 'bg-gradient-to-r from-white via-purple-100/90 to-violet-200/85 border-b border-purple-100/80',
    profileAvatarBorder: 'border-white',
  },

  emerald_mint: {
    id: 'emerald_mint',
    name: 'Jade Mist',
    tagline: 'Crisp white · Botanical emerald glass',
    isDark: false,
    timetableVariant: 'light',
    swatchGradient: 'from-white via-emerald-200 to-teal-600',
    swatchRing: 'ring-emerald-500',
    appShell: 'bg-gradient-to-br from-white via-[#ECFDF5] to-[#D1FAE5] text-slate-900',
    orb1: 'bg-gradient-to-br from-white via-emerald-200/55 to-teal-300/35',
    orb2: 'bg-gradient-to-bl from-emerald-400/30 via-teal-300/30 to-white/10',
    orb3: 'bg-gradient-to-tr from-teal-200/35 via-white/50 to-emerald-300/30',
    orb4: 'bg-gradient-to-tl from-emerald-500/20 via-teal-300/30 to-white/20',
    sidebar:
      'bg-gradient-to-b from-white/86 via-white/76 to-emerald-50/82 backdrop-blur-2xl text-slate-900 border-r border-white/90 shadow-[8px_0_32px_-12px_rgba(16,185,129,0.16)]',
    sidebarHeader: 'border-b border-emerald-100/80 bg-gradient-to-r from-white/75 to-emerald-50/65',
    sidebarFooter: 'border-t border-emerald-100/80 bg-gradient-to-t from-emerald-50/75 to-white/60 backdrop-blur-md',
    sidebarDivider: 'border-t border-emerald-100/80',
    brandBadge: 'bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-500/25',
    brandSubtext: 'text-emerald-700/85',
    navActive:
      'bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-500 text-white shadow-[0_8px_20px_-6px_rgba(16,185,129,0.45)] border border-emerald-500/30',
    navInactive:
      'text-slate-700 hover:bg-white/80 hover:text-emerald-950 hover:shadow-sm border border-transparent hover:border-emerald-100',
    navIconInactive: 'text-emerald-600/80',
    navBadgeInactive: 'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
    navBadgeActive: 'bg-white/25 text-white',
    profileMiniCard:
      'bg-white/85 hover:bg-white border border-white ring-1 ring-emerald-100 hover:ring-emerald-300 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-sm',
    profileMiniMeta: 'text-emerald-700/85',
    logoutBtn: 'bg-white/80 border border-rose-200/80 text-rose-700 hover:bg-rose-50',
    header:
      'bg-white/72 backdrop-blur-2xl border-b border-white/90 shadow-[0_6px_24px_-12px_rgba(16,185,129,0.15)]',
    headerBreadcrumb: 'text-emerald-700/80',
    heroCard:
      'bg-gradient-to-br from-white/92 via-emerald-50/82 to-teal-100/75 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-emerald-300/60 shadow-[0_20px_48px_-16px_rgba(16,185,129,0.22),inset_0_1px_0_rgba(255,255,255,0.95)]',
    heroGlow: 'bg-gradient-to-bl from-emerald-400/25 via-teal-300/20 to-transparent',
    glassCard:
      'bg-white/78 backdrop-blur-xl rounded-xl border border-white ring-1 ring-emerald-200/60 shadow-[0_14px_38px_-14px_rgba(16,185,129,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
    glassCardHover: 'hover:bg-white/95 hover:ring-emerald-400/70',
    cardHeader: 'border-b border-emerald-100/80 bg-gradient-to-r from-white/82 via-emerald-50/70 to-teal-50/75',
    softInset: 'bg-gradient-to-br from-white/90 to-emerald-50/90 border border-emerald-100',
    divider: 'divide-y divide-emerald-100/70',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    textAccent: 'text-emerald-700',
    primaryBtn:
      'bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white shadow-[0_8px_22px_-6px_rgba(16,185,129,0.45)] border border-emerald-500/30',
    secondaryBtn:
      'bg-white/85 backdrop-blur-md hover:bg-white text-emerald-950 border border-emerald-200/80 hover:border-emerald-300 shadow-xs',
    iconBtn:
      'bg-white/82 backdrop-blur-md border border-emerald-200/80 text-slate-700 hover:text-emerald-700 hover:bg-white shadow-xs',
    accentBadge: 'bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/20',
    barTrack: 'bg-emerald-100/85',
    barFill: 'bg-gradient-to-t from-emerald-600 via-emerald-500 to-teal-400',
    input:
      'bg-white/88 border border-emerald-200/80 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500',
    selectOption: 'bg-white text-slate-900',
    modalBackdrop: 'bg-slate-900/45 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-white/95 via-white/90 to-emerald-50/90 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-emerald-200/75 shadow-2xl',
    modalHeader: 'border-b border-emerald-100/80 bg-gradient-to-r from-white via-emerald-50/80 to-teal-50/85',
    onboardingSidebar:
      'bg-gradient-to-b from-white/90 via-emerald-50/75 to-teal-100/70 text-slate-900 border-r border-white/90',
    onboardingContainer:
      'bg-white/85 backdrop-blur-2xl border-0 sm:border border-white ring-1 ring-emerald-200/65 shadow-[0_24px_60px_-15px_rgba(16,185,129,0.24)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-emerald-50/95 to-teal-100/85 border-emerald-400 text-emerald-950 shadow-sm',
    subjectUnselectedCard:
      'bg-white/78 backdrop-blur-md hover:bg-white border-emerald-100 hover:border-emerald-300 text-slate-800',
    chatMeBubble: 'bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-500 text-white shadow-md shadow-emerald-500/20',
    chatOtherBubble: 'bg-white/85 backdrop-blur-md text-slate-800 border border-white ring-1 ring-emerald-100 shadow-xs',
    chatRoomBg: 'bg-emerald-50/30',
    unreadMessageCard: 'bg-gradient-to-r from-white/95 to-emerald-50/90 border-emerald-300 shadow-sm',
    readMessageCard: 'bg-white/80 border-white ring-1 ring-emerald-100 hover:bg-white',
    profileBanner: 'bg-gradient-to-r from-white via-emerald-100/90 to-teal-200/85 border-b border-emerald-100/80',
    profileAvatarBorder: 'border-white',
  },

  rose_quartz: {
    id: 'rose_quartz',
    name: 'Rose Quartz',
    tagline: 'Pearl white · Blush rose glass',
    isDark: false,
    timetableVariant: 'light',
    swatchGradient: 'from-white via-rose-200 to-rose-600',
    swatchRing: 'ring-rose-500',
    appShell: 'bg-gradient-to-br from-white via-[#FFF1F2] to-[#FFE4E6] text-slate-900',
    orb1: 'bg-gradient-to-br from-white via-rose-200/55 to-pink-300/35',
    orb2: 'bg-gradient-to-bl from-rose-400/30 via-pink-300/30 to-white/10',
    orb3: 'bg-gradient-to-tr from-pink-200/35 via-white/50 to-rose-300/30',
    orb4: 'bg-gradient-to-tl from-rose-500/20 via-pink-300/30 to-white/20',
    sidebar:
      'bg-gradient-to-b from-white/86 via-white/76 to-rose-50/82 backdrop-blur-2xl text-slate-900 border-r border-white/90 shadow-[8px_0_32px_-12px_rgba(244,63,94,0.16)]',
    sidebarHeader: 'border-b border-rose-100/80 bg-gradient-to-r from-white/75 to-rose-50/65',
    sidebarFooter: 'border-t border-rose-100/80 bg-gradient-to-t from-rose-50/75 to-white/60 backdrop-blur-md',
    sidebarDivider: 'border-t border-rose-100/80',
    brandBadge: 'bg-gradient-to-br from-rose-600 via-rose-500 to-pink-500 text-white shadow-md shadow-rose-500/25',
    brandSubtext: 'text-rose-700/85',
    navActive:
      'bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500 text-white shadow-[0_8px_20px_-6px_rgba(244,63,94,0.45)] border border-rose-500/30',
    navInactive:
      'text-slate-700 hover:bg-white/80 hover:text-rose-950 hover:shadow-sm border border-transparent hover:border-rose-100',
    navIconInactive: 'text-rose-600/80',
    navBadgeInactive: 'bg-rose-50 text-rose-700 border border-rose-200/80',
    navBadgeActive: 'bg-white/25 text-white',
    profileMiniCard:
      'bg-white/85 hover:bg-white border border-white ring-1 ring-rose-100 hover:ring-rose-300 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-rose-600 to-pink-500 text-white shadow-sm',
    profileMiniMeta: 'text-rose-700/85',
    logoutBtn: 'bg-white/80 border border-rose-200/80 text-rose-700 hover:bg-rose-50',
    header:
      'bg-white/72 backdrop-blur-2xl border-b border-white/90 shadow-[0_6px_24px_-12px_rgba(244,63,94,0.15)]',
    headerBreadcrumb: 'text-rose-700/80',
    heroCard:
      'bg-gradient-to-br from-white/92 via-rose-50/82 to-pink-100/75 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-rose-300/60 shadow-[0_20px_48px_-16px_rgba(244,63,94,0.22),inset_0_1px_0_rgba(255,255,255,0.95)]',
    heroGlow: 'bg-gradient-to-bl from-rose-400/25 via-pink-300/20 to-transparent',
    glassCard:
      'bg-white/78 backdrop-blur-xl rounded-xl border border-white ring-1 ring-rose-200/60 shadow-[0_14px_38px_-14px_rgba(244,63,94,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
    glassCardHover: 'hover:bg-white/95 hover:ring-rose-400/70',
    cardHeader: 'border-b border-rose-100/80 bg-gradient-to-r from-white/82 via-rose-50/70 to-pink-50/75',
    softInset: 'bg-gradient-to-br from-white/90 to-rose-50/90 border border-rose-100',
    divider: 'divide-y divide-rose-100/70',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    textAccent: 'text-rose-700',
    primaryBtn:
      'bg-gradient-to-r from-rose-600 via-rose-500 to-pink-500 hover:from-rose-700 hover:to-pink-600 text-white shadow-[0_8px_22px_-6px_rgba(244,63,94,0.45)] border border-rose-500/30',
    secondaryBtn:
      'bg-white/85 backdrop-blur-md hover:bg-white text-rose-950 border border-rose-200/80 hover:border-rose-300 shadow-xs',
    iconBtn:
      'bg-white/82 backdrop-blur-md border border-rose-200/80 text-slate-700 hover:text-rose-700 hover:bg-white shadow-xs',
    accentBadge: 'bg-gradient-to-br from-rose-600 via-rose-500 to-pink-500 text-white shadow-md shadow-rose-500/20',
    barTrack: 'bg-rose-100/85',
    barFill: 'bg-gradient-to-t from-rose-600 via-rose-500 to-pink-400',
    input:
      'bg-white/88 border border-rose-200/80 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500',
    selectOption: 'bg-white text-slate-900',
    modalBackdrop: 'bg-slate-900/45 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-white/95 via-white/90 to-rose-50/90 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-rose-200/75 shadow-2xl',
    modalHeader: 'border-b border-rose-100/80 bg-gradient-to-r from-white via-rose-50/80 to-pink-50/85',
    onboardingSidebar:
      'bg-gradient-to-b from-white/90 via-rose-50/75 to-pink-100/70 text-slate-900 border-r border-white/90',
    onboardingContainer:
      'bg-white/85 backdrop-blur-2xl border-0 sm:border border-white ring-1 ring-rose-200/65 shadow-[0_24px_60px_-15px_rgba(244,63,94,0.24)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-rose-50/95 to-pink-100/85 border-rose-400 text-rose-950 shadow-sm',
    subjectUnselectedCard:
      'bg-white/78 backdrop-blur-md hover:bg-white border-rose-100 hover:border-rose-300 text-slate-800',
    chatMeBubble: 'bg-gradient-to-br from-rose-600 via-rose-500 to-pink-500 text-white shadow-md shadow-rose-500/20',
    chatOtherBubble: 'bg-white/85 backdrop-blur-md text-slate-800 border border-white ring-1 ring-rose-100 shadow-xs',
    chatRoomBg: 'bg-rose-50/30',
    unreadMessageCard: 'bg-gradient-to-r from-white/95 to-rose-50/90 border-rose-300 shadow-sm',
    readMessageCard: 'bg-white/80 border-white ring-1 ring-rose-100 hover:bg-white',
    profileBanner: 'bg-gradient-to-r from-white via-rose-100/90 to-pink-200/85 border-b border-rose-100/80',
    profileAvatarBorder: 'border-white',
  },

  amber_ivory: {
    id: 'amber_ivory',
    name: 'Sunlit Amber',
    tagline: 'Warm ivory · Golden honey glass',
    isDark: false,
    timetableVariant: 'light',
    swatchGradient: 'from-white via-amber-200 to-amber-600',
    swatchRing: 'ring-amber-500',
    appShell: 'bg-gradient-to-br from-white via-[#FFFBEB] to-[#FEF3C7] text-slate-900',
    orb1: 'bg-gradient-to-br from-white via-amber-200/55 to-orange-200/35',
    orb2: 'bg-gradient-to-bl from-amber-400/25 via-yellow-200/35 to-white/10',
    orb3: 'bg-gradient-to-tr from-orange-200/35 via-white/50 to-amber-300/25',
    orb4: 'bg-gradient-to-tl from-amber-500/20 via-yellow-300/25 to-white/20',
    sidebar:
      'bg-gradient-to-b from-white/86 via-white/76 to-amber-50/82 backdrop-blur-2xl text-slate-900 border-r border-white/90 shadow-[8px_0_32px_-12px_rgba(217,119,6,0.16)]',
    sidebarHeader: 'border-b border-amber-100/80 bg-gradient-to-r from-white/75 to-amber-50/65',
    sidebarFooter: 'border-t border-amber-100/80 bg-gradient-to-t from-amber-50/75 to-white/60 backdrop-blur-md',
    sidebarDivider: 'border-t border-amber-100/80',
    brandBadge: 'bg-gradient-to-br from-amber-600 via-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25',
    brandSubtext: 'text-amber-800/85',
    navActive:
      'bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 text-white shadow-[0_8px_20px_-6px_rgba(217,119,6,0.45)] border border-amber-500/30',
    navInactive:
      'text-slate-700 hover:bg-white/80 hover:text-amber-950 hover:shadow-sm border border-transparent hover:border-amber-100',
    navIconInactive: 'text-amber-600/80',
    navBadgeInactive: 'bg-amber-50 text-amber-800 border border-amber-200/80',
    navBadgeActive: 'bg-white/25 text-white',
    profileMiniCard:
      'bg-white/85 hover:bg-white border border-white ring-1 ring-amber-100 hover:ring-amber-300 shadow-sm',
    profileMiniAvatar: 'bg-gradient-to-br from-amber-600 to-orange-500 text-white shadow-sm',
    profileMiniMeta: 'text-amber-800/85',
    logoutBtn: 'bg-white/80 border border-rose-200/80 text-rose-700 hover:bg-rose-50',
    header:
      'bg-white/72 backdrop-blur-2xl border-b border-white/90 shadow-[0_6px_24px_-12px_rgba(217,119,6,0.15)]',
    headerBreadcrumb: 'text-amber-800/80',
    heroCard:
      'bg-gradient-to-br from-white/92 via-amber-50/82 to-yellow-100/75 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-amber-300/60 shadow-[0_20px_48px_-16px_rgba(217,119,6,0.22),inset_0_1px_0_rgba(255,255,255,0.95)]',
    heroGlow: 'bg-gradient-to-bl from-amber-400/25 via-yellow-300/20 to-transparent',
    glassCard:
      'bg-white/78 backdrop-blur-xl rounded-xl border border-white ring-1 ring-amber-200/60 shadow-[0_14px_38px_-14px_rgba(217,119,6,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]',
    glassCardHover: 'hover:bg-white/95 hover:ring-amber-400/70',
    cardHeader: 'border-b border-amber-100/80 bg-gradient-to-r from-white/82 via-amber-50/70 to-orange-50/70',
    softInset: 'bg-gradient-to-br from-white/90 to-amber-50/90 border border-amber-100',
    divider: 'divide-y divide-amber-100/70',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-700',
    textMuted: 'text-slate-500',
    textAccent: 'text-amber-800',
    primaryBtn:
      'bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 hover:from-amber-700 hover:to-orange-600 text-white shadow-[0_8px_22px_-6px_rgba(217,119,6,0.45)] border border-amber-500/30',
    secondaryBtn:
      'bg-white/85 backdrop-blur-md hover:bg-white text-amber-950 border border-amber-200/80 hover:border-amber-300 shadow-xs',
    iconBtn:
      'bg-white/82 backdrop-blur-md border border-amber-200/80 text-slate-700 hover:text-amber-700 hover:bg-white shadow-xs',
    accentBadge: 'bg-gradient-to-br from-amber-600 via-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20',
    barTrack: 'bg-amber-100/85',
    barFill: 'bg-gradient-to-t from-amber-600 via-amber-500 to-orange-400',
    input:
      'bg-white/88 border border-amber-200/80 text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500',
    selectOption: 'bg-white text-slate-900',
    modalBackdrop: 'bg-slate-900/45 backdrop-blur-md',
    modalPanel:
      'bg-gradient-to-br from-white/95 via-white/90 to-amber-50/90 backdrop-blur-2xl rounded-xl border border-white ring-1 ring-amber-200/75 shadow-2xl',
    modalHeader: 'border-b border-amber-100/80 bg-gradient-to-r from-white via-amber-50/80 to-orange-50/85',
    onboardingSidebar:
      'bg-gradient-to-b from-white/90 via-amber-50/75 to-yellow-100/70 text-slate-900 border-r border-white/90',
    onboardingContainer:
      'bg-white/85 backdrop-blur-2xl border-0 sm:border border-white ring-1 ring-amber-200/65 shadow-[0_24px_60px_-15px_rgba(217,119,6,0.24)]',
    subjectSelectedCard:
      'bg-gradient-to-br from-amber-50/95 to-yellow-100/85 border-amber-400 text-amber-950 shadow-sm',
    subjectUnselectedCard:
      'bg-white/78 backdrop-blur-md hover:bg-white border-amber-100 hover:border-amber-300 text-slate-800',
    chatMeBubble: 'bg-gradient-to-br from-amber-600 via-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20',
    chatOtherBubble: 'bg-white/85 backdrop-blur-md text-slate-800 border border-white ring-1 ring-amber-100 shadow-xs',
    chatRoomBg: 'bg-amber-50/30',
    unreadMessageCard: 'bg-gradient-to-r from-white/95 to-amber-50/90 border-amber-300 shadow-sm',
    readMessageCard: 'bg-white/80 border-white ring-1 ring-amber-100 hover:bg-white',
    profileBanner: 'bg-gradient-to-r from-white via-amber-100/90 to-yellow-200/85 border-b border-amber-100/80',
    profileAvatarBorder: 'border-white',
  },
};

export const TEACHER_THEME_LIST: TeacherThemeConfig[] = [
  TEACHER_THEMES.white_blue,
  TEACHER_THEMES.obsidian_purple,
  TEACHER_THEMES.midnight_cyan,
  TEACHER_THEMES.lavender_mist,
  TEACHER_THEMES.emerald_mint,
  TEACHER_THEMES.rose_quartz,
  TEACHER_THEMES.amber_ivory,
];

export function resolveTeacherTheme(themeId?: string | null): TeacherThemeConfig {
  if (themeId && themeId in TEACHER_THEMES) {
    return TEACHER_THEMES[themeId as TeacherThemeId];
  }
  return TEACHER_THEMES.white_blue;
}
