# Pentric — Comprehensive Developer Documentation Manual
**Version:** 3.0.0 (Production Release)  
**Created By:** PBFA INNOVATIONS AND TECHNOLOGY  
**Official Website:** [pbfa.netlify.app](https://pbfa.netlify.app)  
**Target Environment:** Node.js (v18+) / React 19 / TypeScript / Express / Vite / Firebase Firestore  

---

## 1. Project Overview

### 1.1 What is Pentric?
**Pentric** is an enterprise-grade academic timetable management and conflict-free scheduling engine built for educational institutions. The platform automates complex combinatorial class and faculty scheduling across standard five-day academic weeks (Monday through Friday, Periods 1 through 8), while offering granular administrative oversight, teacher self-service dashboards, period swap workflows, and multi-school tenancy.

### 1.2 The Problem Pentric Solves
Secondary and primary schools face significant operational challenges when scheduling hundreds of weekly class periods across diverse subjects, specialized laboratories, and faculty availability. Manual scheduling frequently results in:
- **Teacher Double-Booking (Inter-Clash):** A teacher assigned to multiple classrooms simultaneously.
- **Class Period Conflicts (Extra-Clash):** A single class stream scheduled with multiple subjects in the same period.
- **Curriculum Load Imbalances:** Core subjects (Mathematics, English) lumped into consecutive periods or late afternoon slots when student attention is low.
- **Faculty Fatigue:** Instructors assigned more than five consecutive teaching periods without rest.

Pentric eliminates these issues through a deterministic constraint-satisfaction scheduling engine with sub-second clash detection, heuristic scoring, and real-time cross-device state synchronization.

### 1.3 Target Audience & User Roles
1. **School Administrators (Super Admin, Academic Admin, Dept Admin, Support Admin):** Configure school parameters, manage curriculum, verify and approve faculty accounts, execute timetable generation runs, make manual schedule adjustments, and export printable timetables.
2. **Teaching Faculty (Teachers):** View personalized weekly teaching schedules, manage lesson notes and links, toggle teaching availability, initiate peer period swap requests, and maintain professional profiles.
3. **Students & Parents (Public Timetable View):** Search and review class schedules without requiring administrative access.

---

## 2. Technology Stack

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Language** | TypeScript | `^5.6.0` | Strict end-to-end type safety |
| **Frontend Framework** | React | `^19.0.0` | Component-based reactive UI |
| **Build & Dev Tool** | Vite | `^6.0.0` | Bundling, HMR, and middleware integration |
| **Styling** | Tailwind CSS | `^4.0.0` | Responsive utility-first interface design |
| **Icons** | Lucide React | Latest | Consistent vector iconography |
| **Backend Server** | Express | `^4.21.0` | Full-stack API proxy, SSE broadcasting, and data persistence |
| **Server Runtime** | Node.js / TSX | `^4.19.0` | TypeScript execution in Node runtime |
| **Database (Persistent)** | Google Cloud Firestore | `^11.0.0` | Cloud database for cross-device real-time sync |
| **Local Store** | JSON Disk Store (`data/ota_store.json`) + Browser `localStorage` | Native | Zero-latency instant offline capability |
| **Authentication** | JWT (`jsonwebtoken`) & `bcryptjs` | Native | Secure token-based session verification & password hashing |
| **Export Engines** | `jspdf`, `jspdf-autotable`, `xlsx`, `html2canvas` | Latest | High-resolution PDF, Excel, and PNG export |

---

## 3. Project Structure

```
.
├── components/                     # Frontend UI Components
│   ├── AboutUsModal.tsx            # Official About Pentric modal with creator attribution
│   ├── AdminDashboard.tsx          # Comprehensive administrative control centre
│   ├── Auth.tsx                    # Multi-tier login, signup, anti-bot email verification
│   ├── LogViewer.tsx               # Timetable generation reasoning and diagnostic log modal
│   ├── PublicTimetable.tsx         # Read-only public timetable viewer for students/parents
│   ├── SchoolPortal.tsx            # Multi-school gateway & registry selector
│   ├── SyncDiagnostics.tsx         # Real-time WebSocket/Firestore sync monitor
│   ├── TeacherDashboard.tsx        # Faculty portal: schedule, availability, profile, swaps
│   ├── TimetableGrid.tsx           # High-density printable timetable grid viewer
│   ├── TutorialOverlay.tsx         # First-run guided interactive walkthrough
│   └── UserGuide.tsx               # Built-in operational manual (Admin & Teacher guides)
├── constants.ts                    # Default academic constants (periods, days, core subjects, classes)
├── data/                           # Server-side persistent storage directory
│   └── ota_store.json              # Local persistent JSON state database
├── firebase-applet-config.json     # Firebase client SDK project parameters
├── firebase-blueprint.json         # Intermediate Representation (IR) database schema blueprint
├── firestore.rules                 # Security rules enforced on Google Cloud Firestore
├── index.html                      # HTML entry point (Pentric branding, SEO, viewport)
├── index.tsx                       # React application bootstrap & root state management
├── metadata.json                   # AI Studio applet capabilities and metadata configuration
├── package.json                    # Project dependencies and operational scripts
├── server.ts                       # Express backend server, SSE hub, and API routes
├── services/                       # Business logic and external integration layer
│   ├── ai.ts                       # Schedule reasoning and audit engine
│   ├── export_utils.ts             # PDF and Excel spreadsheet generators
│   ├── firebase.ts                 # Client-side Firebase SDK initialization
│   ├── firebaseAdmin.ts            # Server-side Firebase Admin SDK & cloud sync helpers
│   ├── generator.ts                # Core constraint-satisfaction timetable algorithm
│   └── storage.ts                  # Client storage coordinator, caching & sync bus
├── tsconfig.json                   # TypeScript compiler options
├── types.ts                        # Master domain TypeScript interface definitions
└── vite.config.ts                  # Vite build and development configuration
```

---

## 4. File-by-File Technical Documentation

### `constants.ts`
- **Purpose:** Declares baseline academic periods, Monday–Friday school days, subject lists, and class streams.
- **Key Exports:**
  - `DAYS`: Array of school days (`['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']`).
  - `PERIODS`: 8 standardized academic periods with start/end timestamps (8:05 AM to 2:10 PM).
  - `BREAK_INDICES`: Indices indicating break placements (Short Break before P5, Long Break before P8).
  - `ALL_SUBJECTS`: Standard default junior and senior secondary school subjects.
  - `ALL_CLASSES`: Standard junior and senior secondary classroom divisions.
- **Safety Warning:** Do NOT modify `DAYS` length or `PERIODS` count without verifying `generator.ts` compatibility.

### `server.ts`
- **Purpose:** Full-stack Express server handling authentication, live state synchronization, school registry management, and SSE broadcasts.
- **Key Endpoints:**
  - `GET /api/sync/events`: Server-Sent Events (SSE) stream broadcasting real-time updates to all connected browser sessions within milliseconds.
  - `GET /api/sync/state`: Returns the differential or full server store state based on version hash.
  - `POST /api/sync/update`: Atomically applies partial or full key modifications and triggers Firestore synchronization.
  - `POST /api/teachers/:id/profile`: Directly updates teacher profile information and profile pictures on disk and in cloud sync.
  - `POST /api/auth/login`: Verifies admin or teacher credentials, handles temporary passwords, and issues JWT tokens.
  - `DELETE /api/schools/:id`: Administrative endpoint to safely remove non-default schools with passkey confirmation.
- **Critical Architecture:** Mutex-safe write-to-disk logic ensures `data/ota_store.json` never gets corrupted during concurrent requests.

### `services/storage.ts`
- **Purpose:** Central client-side data coordinator. Bridges browser `localStorage`, Firestore real-time listeners, and Express SSE synchronization.
- **Key Methods:**
  - `getTeachers()` / `saveTeacher()`: Faculty management with robust base64 avatar quota protection and local profile picture fallback.
  - `getTeacherProfilePicture(id)`: Guaranteed retrieval of a teacher's specific profile picture from disk or memory.
  - `getTimetable()` / `saveTimetable()`: Master timetable retrieval and change broadcasting.
  - `getSchools()` / `saveSchool()` / `deleteSchool()`: Institutional registry operations.
  - `fetchLatestFromApi(forceFull)`: Immediate differential poll against the backend server.
- **Profile Picture Safety:** Implements independent keying via `ota_profile_pic_${teacher.id}`, preventing accidental overwriting across multiple faculty profiles.

### `services/generator.ts`
- **Purpose:** Protected core timetable scheduling engine. Employs constraint programming and heuristic search to generate valid school schedules.
- **Key Functions:**
  - `generateTimetable(...)`: Main scheduling entry point. Evaluates teacher subject assignments, availability matrices, room restrictions, and class period requirements.
  - `detectGridConflicts(...)`: Inspects any grid configuration for inter-clashes (teacher double-bookings) and extra-clashes (class period overloads).

### `components/AdminDashboard.tsx`
- **Purpose:** Administrative operations command centre.
- **Navigation Architecture:**
  - **School Management:** School Registry, Classes, Curriculum (Subjects), Faculty (Teachers).
  - **Timetable:** Master Schedule, Requests, Absences & Subs.
  - **Communications:** Inbox, Audit Trail.
  - **Settings & System:** Settings, Admins, User Guide, About Pentric, Sync Diagnostics, Logs & Reports.
- **Features:** Expandable navigation groups, automated schedule generation, manual cell editing with override badges, and teacher account approvals.

### `components/TeacherDashboard.tsx`
- **Purpose:** Dedicated teaching faculty workspace.
- **Workflows:**
  - Weekly personalized schedule view with period breakdown and fatigue metrics.
  - Faculty profile updates with client-side canvas avatar downsampling (256x256 square JPEG).
  - Interactive lesson notes and link attachment.
  - Peer period swap requests with live notification dispatch.

### `components/AboutUsModal.tsx`
- **Purpose:** Production About dialog.
- **Branding:** Accurately states that Pentric was created by **PBFA INNOVATIONS AND TECHNOLOGY** ([pbfa.netlify.app](https://pbfa.netlify.app)).

### `components/UserGuide.tsx`
- **Purpose:** Built-in operational manual containing separate, step-by-step guides for both Administrators and Teachers.

---

## 5. Timetable Engine & Scheduling Rules

### 5.1 Weekly Grid Representation
The master academic timetable is structured as a three-dimensional mapping:
$$\text{Grid} : \text{ClassID} \to \text{DayIndex } [0..4] \to \text{PeriodIndex } [0..7] \to \text{TimetableCell}$$

### 5.2 Enforced Invariants
1. **Teacher Uniqueness (Inter-Clash Prohibition):**
   $$\forall \text{ teacher } T, \text{ day } D, \text{ period } P: \quad \sum_{\text{classes } C} \mathbf{1}_{[\text{Grid}[C][D][P].\text{teacherId} = T]} \le 1$$
   No teacher can be scheduled in two places simultaneously.
2. **Class Exclusivity (Extra-Clash Prohibition):**
   $$\forall \text{ class } C, \text{ day } D, \text{ period } P: \quad \text{Grid}[C][D][P] \text{ holds at most 1 distinct lesson (except parallel tracks)}.$$
3. **Core Morning Placement:**
   Core subjects (Mathematics, English) are prioritized for Periods 1–4 before the primary break.
4. **Consecutive Period Cap:**
   Teachers are protected against scheduling runs exceeding five continuous periods without an intervening break or free period.

---

## 6. Teacher Profile Picture System & Bug Fix Documentation

### 6.1 Issue History
In previous development iterations, when a teacher uploaded an updated profile picture in their personal dashboard, the picture rendered on the teacher's screen but failed to display inside the administrative **Faculty** tab.

### 6.2 Root Cause Analysis
1. **Local State Isolation:** Avatars were stored solely in the client's localized `profileData` state and isolated browser storage keys without triggering full cloud synchronization.
2. **Payload Size Restrictions:** High-resolution uncompressed camera photos (often 3MB–8MB) exceeded browser `localStorage` quotas when embedded directly into the 126-teacher array string, causing silent storage write rejections.
3. **Admin Rendering Blindness:** The Admin teacher list and modal only inspected `t.profilePicture` on the cached teacher array, rather than reading the dedicated per-teacher key `ota_profile_pic_${t.id}`.

### 6.3 Implemented Fix
1. **Canvas Downsampling:** When a teacher selects an image file, `TeacherDashboard.tsx` uses a 2D canvas to downsample and crop the image into a crisp 256x256 JPEG data URL (`~25KB`).
2. **Dedicated Persistence:** The image is immediately written to `localStorage.setItem('ota_profile_pic_' + teacher.id, ...)`, dispatched via `storage.saveTeacher()`, and posted to the `/api/teachers/:id/profile` backend endpoint.
3. **Admin Fallback Resolution:** Both `storage.getTeachers()`, the teacher list view, and the `viewTeacher` modal in `AdminDashboard.tsx` incorporate `storage.getTeacherProfilePicture(t.id)` fallback resolution.

---

## 7. Removed Testing Features & Prohibited Additions

During the production finalization of Pentric, the following test and placeholder features were intentionally eliminated:
1. **ROM:** Development-only memory inspection module.
2. **Venue Exams:** Unfinished experimental examination scheduler (`ExamScheduler.tsx`).
3. **Bulk Import:** Non-functional spreadsheet file upload placeholder.
4. **Analytics:** Dead charting placeholder routes.

> **CRITICAL RULE FOR FUTURE MAINTAINERS:**  
> Do **NOT** reintroduce ROM, Venue Exams, Bulk Import, or Analytics. Their removal was deliberate to ensure system stability, clean navigation, and zero dead controls.

---

## 8. Installation & Development Setup

### 8.1 Prerequisites
- **Node.js:** v18.0.0 or higher
- **NPM:** v9.0.0 or higher

### 8.2 Installation Steps
```bash
# 1. Install dependencies
npm install

# 2. Launch development environment (Express + Vite on Port 3000)
npm run dev

# 3. Build for production distribution
npm run build

# 4. Verify code cleanliness
npm run lint
```

---

## 9. Safe Development & Maintenance Rules

1. **Never Wipe the Database:** Existing institutions, faculty accounts, and saved timetables in `data/ota_store.json` must be preserved.
2. **Preserve the Timetable Brain:** Do not rewrite or replace the core scheduling solver in `services/generator.ts`.
3. **No Dead Controls:** Every button, toggle, and dropdown in the user interface must perform a legitimate function.
4. **Attribution Integrity:** Maintain visible creator attribution to **PBFA INNOVATIONS AND TECHNOLOGY** ([pbfa.netlify.app](https://pbfa.netlify.app)).
5. **Security First:** Never hardcode secrets, passwords, or credentials into source files.
