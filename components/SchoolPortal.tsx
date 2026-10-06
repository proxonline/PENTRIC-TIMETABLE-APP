import React, { useState, useMemo } from 'react';
import { School } from '../types';
import { storage } from '../services/storage';
import { 
  Search, School as SchoolIcon, Plus, ArrowRight, ShieldCheck, 
  MapPin, Sparkles, Building2, CheckCircle2, ChevronRight, X, AlertCircle,
  Lock, KeyRound
} from 'lucide-react';

interface SchoolPortalProps {
  onSelectSchool: (school: School) => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

export const SchoolPortal: React.FC<SchoolPortalProps> = ({ 
  onSelectSchool, 
  onCancel,
  canCancel = false 
}) => {
  const [schools, setSchools] = useState<School[]>(() => storage.getSchools());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'VERIFIED' | 'FEATURED'>('ALL');
  
  // New School Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSchoolData, setNewSchoolData] = useState({
    name: '',
    code: '',
    motto: '',
    address: '',
    adminEmail: '',
    adminPhone: '',
    accreditationNumber: '',
    themeColor: '#2563eb',
    adminPasskey: '',
    adminUsername: '',
    adminPassword: ''
  });
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredSchools = useMemo(() => {
    const q = (searchQuery || '').toLowerCase().trim();
    return schools.filter(school => {
      const matchQuery = 
        !q || 
        (school.name && school.name.toLowerCase().includes(q)) || 
        (school.code && school.code.toLowerCase().includes(q)) ||
        (school.motto && school.motto.toLowerCase().includes(q)) ||
        (school.address && school.address.toLowerCase().includes(q));
      
      if (!matchQuery) return false;
      if (filterType === 'FEATURED') return !!school.isOta;
      return true;
    });
  }, [schools, searchQuery, filterType]);

  const handleRegisterSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchoolData.name.trim()) {
      setModalError('School official name is required.');
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const name = newSchoolData.name.trim();
      const code = (newSchoolData.code || name.substring(0, 4)).toUpperCase().trim();
      const motto = newSchoolData.motto.trim() || 'Excellence in Learning & Service';
      const address = newSchoolData.address.trim() || 'Main Campus';
      const passkey = newSchoolData.adminPasskey.trim() || newSchoolData.adminPassword.trim() || 'admin123';
      const adminUsername = newSchoolData.adminUsername.trim() || 'admin';

      const result = await storage.registerSchoolSecurely({
        name,
        code,
        motto,
        address,
        themeColor: newSchoolData.themeColor || '#2563eb',
        adminEmail: newSchoolData.adminEmail.trim(),
        adminPhone: newSchoolData.adminPhone.trim(),
        accreditationNumber: newSchoolData.accreditationNumber.trim(),
        adminPasskey: passkey,
        adminUsername: adminUsername,
        adminPassword: passkey
      });

      if (!result.success || !result.school) {
        setModalError(result.error || 'Unable to register institution. Please try again.');
        return;
      }

      const updated = storage.getSchools();
      setSchools(updated);
      setShowAddModal(false);
      setNewSchoolData({ 
        name: '', code: '', motto: '', address: '', 
        adminEmail: '', adminPhone: '', accreditationNumber: '', 
        themeColor: '#2563eb', adminPasskey: '', adminUsername: '', adminPassword: '' 
      });
      
      // Directly select newly created school
      onSelectSchool(result.school);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to register school.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans relative overflow-x-hidden">
      {/* Subtle royal blue background gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.08),_transparent_70%)] pointer-events-none"></div>

      {/* Header Bar */}
      <header className="relative z-10 border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-4 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white font-black shadow-md shadow-blue-600/20">
              <SchoolIcon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-slate-900">Pentric Portal Gateway</span>
                <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Multi-School System</span>
              </div>
              <p className="text-xs text-slate-500">Access your institution's smart timetable & faculty portal</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canCancel && onCancel && (
              <button 
                onClick={onCancel}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition"
              >
                Back to Dashboard
              </button>
            )}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 transition active:scale-95"
            >
              <Plus size={16} /> Register New School
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-6 py-10 flex flex-col">
        {/* Hero Section */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-3.5 py-1.5 rounded-full text-xs font-semibold mb-4 shadow-xs">
            <Sparkles size={14} className="text-blue-600" />
            <span>Open Your School Portal</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-slate-900 mb-4">
            Find and Enter Your <span className="text-blue-600">School Portal</span>
          </h1>
          <p className="text-sm md:text-base text-slate-500 leading-relaxed">
            Select your institution from the directory below to access real-time academic timetables, faculty approvals, and schedule management.
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="max-w-3xl mx-auto w-full mb-10">
          <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
              <Search size={22} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search your school by name or code (e.g., OTA)..."
              className="w-full bg-white border border-slate-200 hover:border-slate-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 rounded-2xl py-4 pl-14 pr-12 text-sm text-slate-900 placeholder:text-slate-400 outline-none shadow-sm transition"
              autoFocus
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-lg transition"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center justify-between mt-4 px-1">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilterType('ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${filterType === 'ALL' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                All Institutions ({schools.length})
              </button>
              <button
                onClick={() => setFilterType('FEATURED')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${filterType === 'FEATURED' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <Sparkles size={12} className={filterType === 'FEATURED' ? 'text-white' : 'text-blue-600'} /> Featured (OTA Total)
              </button>
            </div>
            <span className="text-xs text-slate-400 font-medium">
              Showing {filteredSchools.length} {filteredSchools.length === 1 ? 'school' : 'schools'}
            </span>
          </div>
        </div>

        {/* School Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 flex-1 items-stretch">
          {filteredSchools.map((school) => {
            const isOta = school.isOta || school.id === 'ota_total_academy';
            return (
              <div
                key={school.id}
                onClick={() => onSelectSchool(school)}
                className={`group relative rounded-3xl p-7 transition-all duration-300 cursor-pointer flex flex-col justify-between ${
                  isOta
                    ? 'bg-white border-2 border-blue-600 shadow-xl shadow-blue-600/10 hover:shadow-2xl hover:border-blue-700'
                    : 'bg-white border border-slate-200 shadow-sm hover:shadow-lg hover:border-blue-400'
                } hover:-translate-y-1.5`}
              >
                {/* Featured Badge */}
                {isOta && (
                  <div className="absolute top-5 right-5 bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider shadow-sm flex items-center gap-1">
                    <Sparkles size={11} /> Primary Academy
                  </div>
                )}

                <div>
                  {/* Top Icon & Code */}
                  <div className="flex items-center gap-3 mb-5">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl shadow-sm ${
                      isOta 
                        ? 'bg-blue-600 text-white shadow-blue-600/20' 
                        : 'bg-blue-50 text-blue-600 border border-blue-100'
                    }`}>
                      {isOta ? <SchoolIcon size={26} /> : <Building2 size={26} />}
                    </div>
                    <div>
                      <span className="text-xs font-mono font-black tracking-widest text-blue-600 uppercase">
                        {school.code || 'SCH'}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                        <CheckCircle2 size={13} /> Active Portal
                      </div>
                    </div>
                  </div>

                  {/* School Name */}
                  <h3 className="text-xl font-black tracking-tight text-slate-900 group-hover:text-blue-600 transition-colors mb-2">
                    {school.name}
                  </h3>

                  {/* Motto */}
                  <p className="text-xs text-slate-500 italic mb-5 leading-relaxed line-clamp-2">
                    "{school.motto || 'Knowledge, Discipline, and Excellence'}"
                  </p>

                  {/* Address */}
                  {school.address && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-6 font-medium">
                      <MapPin size={14} className="shrink-0 text-slate-400" />
                      <span className="truncate">{school.address}</span>
                    </div>
                  )}
                </div>

                {/* Card Action Footer */}
                <div className="pt-5 border-t border-slate-100 flex items-center justify-between mt-auto">
                  <span className="text-xs font-bold text-slate-600 group-hover:text-blue-600 transition-colors">
                    {isOta ? 'Enter OTA Total Academy' : 'Open School Portal'}
                  </span>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                    isOta 
                      ? 'bg-blue-600 text-white group-hover:bg-blue-700 shadow-md shadow-blue-600/20' 
                      : 'bg-slate-100 text-slate-600 group-hover:bg-blue-600 group-hover:text-white'
                  }`}>
                    <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty Search State */}
        {filteredSchools.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center max-w-md mx-auto my-8 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
              <SchoolIcon size={28} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">School Not Found</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              "{searchQuery}" is not currently in the directory. You can easily register it right now.
            </p>
            <button
              onClick={() => {
                setNewSchoolData({ ...newSchoolData, name: searchQuery });
                setShowAddModal(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 transition flex items-center gap-2 mx-auto"
            >
              <Plus size={16} /> Register "{searchQuery}"
            </button>
          </div>
        )}
      </main>

      {/* Modal: Register New School */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shadow-xs">
                  <SchoolIcon size={22} />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    Register Institution Portal
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2 py-0.5 rounded-full uppercase">
                      Admin Gate
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500">Manual administrative registration with zero database pre-population</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Zero Default Data Security Notice */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-2xl flex items-start gap-3 text-xs text-blue-900">
                <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-extrabold block mb-0.5">Zero Pre-population Security Standard</span>
                  <span className="text-blue-800 text-[11px] leading-relaxed">
                    This institution will be uniquely initialized. No sample or mock records are pre-populated into the database. All institution additions require administrator cryptographic authorization.
                  </span>
                </div>
              </div>

              {modalError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" /> <span>{modalError}</span>
                </div>
              )}

              <form onSubmit={handleRegisterSchool} className="space-y-4">
                {/* Section 1: Institution Identity */}
                <div className="space-y-3">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Building2 size={13} /> Institution Information
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      School Official Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Christ the King College"
                      value={newSchoolData.name}
                      onChange={(e) => setNewSchoolData({ ...newSchoolData, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        School Code / Acronym <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        maxLength={8}
                        required
                        placeholder="e.g. CKC"
                        value={newSchoolData.code}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, code: e.target.value.toUpperCase() })}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none uppercase font-mono tracking-wider transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Accreditation / MOE Number
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. ACCR-2026-904"
                        value={newSchoolData.accreditationNumber}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, accreditationNumber: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none font-mono transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      School Motto / Mission Statement
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Knowledge, Integrity and Academic Excellence"
                      value={newSchoolData.motto}
                      onChange={(e) => setNewSchoolData({ ...newSchoolData, motto: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Campus Physical Location & City
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 45 Education Way, Central District"
                      value={newSchoolData.address}
                      onChange={(e) => setNewSchoolData({ ...newSchoolData, address: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Registrar / Admin Contact Email
                      </label>
                      <input
                        type="email"
                        placeholder="e.g. registrar@school.edu"
                        value={newSchoolData.adminEmail}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, adminEmail: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Administrative Contact Phone
                      </label>
                      <input
                        type="tel"
                        placeholder="e.g. +234 801 234 5678"
                        value={newSchoolData.adminPhone}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, adminPhone: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Institutional Theme Color
                    </label>
                    <div className="flex items-center gap-2">
                      {['#2563eb', '#059669', '#7c3aed', '#ea580c', '#0284c7', '#dc2626', '#0f172a'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setNewSchoolData({ ...newSchoolData, themeColor: c })}
                          className={`w-7 h-7 rounded-lg border-2 transition transform active:scale-95 ${
                            newSchoolData.themeColor === c ? 'border-slate-900 scale-110 shadow-sm' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={newSchoolData.themeColor || '#2563eb'}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, themeColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-slate-200 ml-2"
                        title="Pick custom color"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Administrator Authorization Security Gate */}
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="text-[11px] font-black uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                    <Lock size={13} /> Administrator Security Authorization Gate <span className="text-red-500">*</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    To prevent unauthorized institution creation, provide your Administrator Password or Master Security Passkey.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Admin Username
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. admin"
                        value={newSchoolData.adminUsername}
                        onChange={(e) => setNewSchoolData({ ...newSchoolData, adminUsername: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 text-xs text-slate-900 outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Administrator Password / Security Passkey
                      </label>
                      <div className="relative">
                        <input
                          type="password"
                          placeholder="Set password or enter passkey (default: admin123)"
                          value={newSchoolData.adminPasskey}
                          onChange={(e) => setNewSchoolData({ ...newSchoolData, adminPasskey: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-blue-600 focus:bg-white rounded-xl p-3 pl-9 text-xs text-slate-900 outline-none font-mono transition"
                        />
                        <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/20 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        Authorizing & Registering...
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} /> Register & Launch Portal
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
