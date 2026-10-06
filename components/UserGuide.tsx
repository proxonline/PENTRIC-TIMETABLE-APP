import React, { useState } from 'react';
import { 
  Shield, Users, BookOpen, Settings, Calendar, AlertTriangle, 
  CheckCircle, Database, Clock, HelpCircle, AlertOctagon, 
  ChevronRight, ArrowRight, UserCheck, KeyRound, Sparkles, School,
  Camera, MessageSquare, Mail, RefreshCw, FileText
} from 'lucide-react';

interface Props {
  role: 'ADMIN' | 'TEACHER';
}

export const UserGuide: React.FC<Props> = ({ role }) => {
  const [activeTab, setActiveTab] = useState<'ADMIN' | 'TEACHER'>(role);

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-20 animate-in fade-in duration-300">
      
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white p-8 md:p-12 rounded-[2.5rem] shadow-xl border border-slate-700/50 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-white/10 text-blue-300 border border-white/10 backdrop-blur-md">
            <HelpCircle size={14} /> Pentric Built-in Documentation
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight">
            User Guide & Documentation
          </h1>
          <p className="text-slate-300 text-sm md:text-base max-w-2xl leading-relaxed">
            Practical operational manual for school administrators and teaching staff. Everything you need to manage your institution, schedule classes, resolve conflicts, and run daily academic routines.
          </p>
          
          {/* Tab Selector */}
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => setActiveTab('ADMIN')}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'ADMIN'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              <Shield size={14} /> Administrator Guide
            </button>
            <button
              onClick={() => setActiveTab('TEACHER')}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer flex items-center gap-2 ${
                activeTab === 'TEACHER'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              <Users size={14} /> Teacher Guide
            </button>
          </div>
        </div>
      </div>

      {/* --- ADMINISTRATOR GUIDE --- */}
      {activeTab === 'ADMIN' && (
        <div className="space-y-8 animate-in fade-in duration-300">
          
          {/* Section 1: Getting Started */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">1</div>
              <h2 className="text-xl font-bold text-slate-800">Logging In & Administrative Dashboard</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Administrators log in using their administrator username and password (or security passkey). Upon logging in, the Dashboard displays high-level statistics for your institution:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="font-bold text-sm text-slate-800 mb-1">Faculty Statistics</div>
                <p className="text-xs text-slate-500">View total approved teachers, pending verification queues, and currently active faculty members.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="font-bold text-sm text-slate-800 mb-1">Curriculum & Classes</div>
                <p className="text-xs text-slate-500">Monitor active junior and senior classes and configured subjects across departments.</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="font-bold text-sm text-slate-800 mb-1">Schedule Status</div>
                <p className="text-xs text-slate-500">Quickly see if the master timetable is currently published to teachers or in draft mode.</p>
              </div>
            </div>
          </div>

          {/* Section 2: School Management */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">2</div>
              <h2 className="text-xl font-bold text-slate-800">School Management (Registry, Classes, Curriculum, Faculty)</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              The <strong>School Management</strong> section in the navigation menu contains four core pillars:
            </p>
            <ul className="space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <School size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <strong>School Registry:</strong> Register new institutions with accreditation codes, motto, and contact details. Each school maintains its own distinct academic workspace.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <BookOpen size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <strong>Classes:</strong> Add, edit, or remove classes (e.g. JS1A, SS2 Science). Classes are categorized into Junior (JSS) and Senior (SSS) streams.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <FileText size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <strong>Curriculum (Subjects):</strong> Define subject names, codes, whether the subject is core or elective, and the number of periods allocated per week.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Users size={16} className="text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <strong>Faculty (Teachers):</strong> View all teacher profiles, approve newly registered teachers, and assign teachers to specific subjects and classes.
                </div>
              </li>
            </ul>
          </div>

          {/* Section 3: Master Timetable Generation */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">3</div>
              <h2 className="text-xl font-bold text-slate-800">Generating the Master Timetable & Clash Prevention</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Pentric includes an automated scheduling engine that schedules lessons across standard school days (Monday to Friday) and periods (P1 to P8, with designated short and long breaks).
            </p>
            <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-2">
              <div className="font-bold text-sm text-blue-900 flex items-center gap-2">
                <Sparkles size={16} className="text-blue-600" /> Clash Prevention Invariants
              </div>
              <p className="text-xs text-blue-800 leading-relaxed">
                Pentric enforces zero double-booking: A teacher cannot be scheduled in two different classrooms simultaneously (Inter-Clash), and a single class cannot have two subjects assigned to the same period (Extra-Clash). Core subjects such as Mathematics and English are distributed evenly throughout the week.
              </p>
            </div>
          </div>

          {/* Section 4: Manual Timetable Editing */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">4</div>
              <h2 className="text-xl font-bold text-slate-800">Editing the Timetable & Manual Overrides</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Administrators can fine-tune any cell directly in the Master Schedule view:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Click on any period cell in the grid to change the assigned subject or teacher.</li>
              <li>Manually edited cells are highlighted with an override indicator to ensure administrative preferences are preserved.</li>
              <li>Use the Export button to save the timetable as a high-resolution PNG image or printable document for noticeboards and classrooms.</li>
            </ul>
          </div>

          {/* Section 5: Deleting an Institution */}
          <div className="bg-white p-8 rounded-3xl border border-red-100 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center font-bold">5</div>
              <h2 className="text-xl font-bold text-red-900">Deleting a School & Safety Safeguards</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              If an institution was registered by mistake or is decommissioned, it can be deleted from the School Registry with strict administrative passkey verification:
            </p>
            <div className="p-4 bg-red-50 rounded-2xl border border-red-200 text-xs text-red-800 space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-red-900">
                <AlertTriangle size={15} /> Important Safety Rules:
              </div>
              <ul className="list-disc list-inside space-y-1">
                <li>Deletion permanently removes the school's registry record and associated configuration.</li>
                <li>The founding default institution (OTA Total Academy) is protected by security rules and cannot be deleted.</li>
                <li>You must enter your administrator passkey to confirm the action.</li>
              </ul>
            </div>
          </div>

        </div>
      )}

      {/* --- TEACHER GUIDE --- */}
      {activeTab === 'TEACHER' && (
        <div className="space-y-8 animate-in fade-in duration-300">
          
          {/* Section 1: Sign Up & Verification */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">1</div>
              <h2 className="text-xl font-bold text-slate-800">Account Registration & Email Verification</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Creating a teacher account involves a secure two-step anti-bot verification process:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Enter your Full Name, Email Address, Username, and Password on the Sign Up tab.</li>
              <li>A unique 6-digit verification code is generated to verify your email address.</li>
              <li>Enter the code to verify your authenticity. Your account is then submitted to the school administration for final faculty verification.</li>
            </ul>
          </div>

          {/* Section 2: Profile & Profile Picture */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">2</div>
              <h2 className="text-xl font-bold text-slate-800">Teacher Profile & Profile Picture</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Keep your faculty profile up to date so administrators and fellow teachers can identify your schedule:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Navigate to your <strong>Profile</strong> tab in the teacher dashboard.</li>
              <li>Click the camera icon on your avatar to upload a photo from your computer or phone.</li>
              <li>The photo is saved automatically to your profile and will display in the administrative faculty roster.</li>
              <li>Update your contact email, phone number, and brief bio at any time.</li>
            </ul>
          </div>

          {/* Section 3: Availability & Timetable Persona */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">3</div>
              <h2 className="text-xl font-bold text-slate-800">Setting Availability & Subject Preferences</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Teachers can indicate which periods they are available to teach, helping the scheduling system accommodate faculty availability:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Open the Availability matrix to toggle between <strong>Available</strong>, <strong>Preferred</strong>, and <strong>Unavailable</strong> for each period.</li>
              <li>Confirm your assigned classes and subjects.</li>
              <li>Once the administrator generates or updates the timetable, your personal weekly schedule reflects your allocated teaching periods.</li>
            </ul>
          </div>

          {/* Section 4: Viewing Your Timetable */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">4</div>
              <h2 className="text-xl font-bold text-slate-800">Understanding Your Timetable & "Free Periods"</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Your weekly view displays all scheduled classes across Monday to Friday:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Each active lesson card shows the <strong>Subject</strong>, <strong>Class</strong> (e.g. SS1 Science), and <strong>Period Time</strong>.</li>
              <li>Cells marked with <em>"Free Period"</em> or empty slots indicate you have no scheduled class during that time.</li>
              <li>Break periods (Short Break between P4 and P5, Long Break between P7 and P8) are clearly marked.</li>
            </ul>
          </div>

          {/* Section 5: Swap Requests & Notifications */}
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">5</div>
              <h2 className="text-xl font-bold text-slate-800">Period Swap Requests & Real-Time Alerts</h2>
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              Need to exchange a period with a colleague? Pentric facilitates transparent peer swaps:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-600">
              <li>Select the lesson you wish to trade and choose the target colleague and slot.</li>
              <li>The colleague receives an instant alert in their inbox to accept or decline the trade.</li>
              <li>Once accepted, the administrator is notified, and your schedule updates seamlessly.</li>
            </ul>
          </div>

        </div>
      )}

      {/* Footer Branding Note */}
      <div className="text-center pt-8 border-t border-slate-200 text-xs text-slate-500">
        Pentric Timetable Management System • Created by <strong>PPF Innovations and Technology Group</strong>
      </div>

    </div>
  );
};
