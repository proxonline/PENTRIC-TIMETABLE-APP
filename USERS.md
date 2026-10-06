
# OTA Smart Timetable - User Guide

Welcome to **OTA Smart**, an advanced academic scheduling platform designed for **Ota Total Academy**. This system streamlines the complex process of generating conflict-free timetables, managing faculty resources, and facilitating communication.

---

## 🔐 Default Credentials

To access the system immediately for testing:

### **Administrator**
*   **Username:** `admin`
*   **Password:** `admin123`

### **Teacher (Sample)**
*   **Username:** `teacher1`
*   **Password:** `password`
*   *(Note: The system auto-generates sample teachers `teacher1` through `teacherX` if the database is empty).*

---

## 🛡️ Role 1: The Administrator (Admin)

The Admin has "God Mode" access to the system. Their primary goal is to configure the school structure and generate the Master Schedule.

### **Core Capabilities**

1.  **Dashboard & KPIs:** 
    *   View high-level statistics: Total Teachers, Active Classes, and System Status.
    *   Monitor the "Timetable Status" (Draft vs. Published).

2.  **Curriculum & Class Management (New Feature):**
    *   **Classes:** Navigate to the **Classes** tab to manage JSS and SSS streams. You can **Add**, **Edit**, or **Delete** classes.
    *   **Curriculum:** Navigate to the **Curriculum** tab. You can now set the **Periods Per Week** for any subject. 
    *   *Deletion Safety:* Clicking the Trash icon triggers a safety modal ("Are you sure?"), preventing accidental data loss.

3.  **Faculty Management:**
    *   Add new teachers, set their passwords, and define their maximum subject load.
    *   Remove teachers who have left the school.

4.  **Master Schedule Generation:**
    *   Navigate to the **Master Schedule** tab.
    *   **Generate:** Click the "Generate" button to run the AI-driven algorithm. It respects constraints like:
        *   No double booking of teachers (Inter-clash).
        *   No double booking of classes (Extra-clash).
        *   Weekly Period Counts (e.g., Maths appearing exactly 5 times).
    *   **Manual Override:** Click any cell in the grid to manually force a specific Subject or Teacher into that slot.
    *   **Export:** Download the schedule as a PNG image.

5.  **Reports & Conflict Detection:**
    *   The **Logs & Reports** tab shows a detailed breakdown of any remaining conflicts (e.g., if a teacher is double-booked due to manual overrides).

6.  **Settings:**
    *   Configure school name, session year, and global constraints (e.g., Max classes per teacher).
    *   **Danger Zone:** Factory reset the system data.

### **Limitations**
*   Admins cannot participate in the "Staff Room" chat as a peer (to maintain professional boundaries), though they receive moderation alerts.
*   Admins cannot set their own "availability"; they manage the system for others.

---

## 🎓 Role 2: The Faculty (Teacher)

The Faculty interface is designed for daily use—viewing schedules, chatting, and requesting changes.

### **Onboarding**
When a teacher logs in for the first time (or if created manually), they go through a **3-Step Wizard**:
1.  **Introduction:** Welcome screen.
2.  **Select Classes:** Teachers select the specific classes they teach (e.g., JS1A, SS2 Science).
3.  **Assign Subjects:** For each selected class, they tick the subjects they deliver.

### **Core Capabilities**

1.  **Personal Dashboard:**
    *   View "Free Periods" remaining for the week.
    *   Quick stats on total teaching hours.

2.  **My Schedule:**
    *   A filtered view showing *only* that teacher's classes.
    *   Clear indicators of Subject, Class, and Room (if applicable).

3.  **Staff Room (Chat):**
    *   A real-time chat room for all faculty members.
    *   **AI Moderation:** Messages are analyzed in real-time. Unprofessional or inappropriate language is flagged and reported to the Admin.

4.  **Requests & Swaps:**
    *   **Manual Request:** Submit a text request (e.g., "I need Friday off").
    *   **Automated Swap Proposal:** 
        1. Go to **Timetables** (Master View).
        2. Click on a slot belonging to another teacher.
        3. A modal appears: "Propose Swap".
        4. Select one of your own lessons to offer in exchange.
        5. The system sends this proposal to the Admin for approval.

5.  **Profile:**
    *   Update Bio, Phone Number, Email, and Profile Picture.

### **Limitations**
*   Teachers cannot edit the Master Schedule directly.
*   Teachers cannot delete classes or subjects.
*   Teachers cannot see private data of other teachers (like passwords or recovery codes).

---

## 🚀 How to Use: Common Workflows

### **Scenario A: Changing Mathematics to 6 Periods/Week**
1.  **Login** as Admin.
2.  Go to **Curriculum**.
3.  Find "Mathematics" (use the search bar).
4.  Click the **Pencil (Edit)** icon.
5.  Change "Periods/Week" from `5` to `6`.
6.  Click **Save**.
7.  Go to **Master Schedule** and click **Generate**. The algorithm will now attempt to fit Maths 6 times for every class.

### **Scenario B: Deleting a Class**
1.  **Login** as Admin.
2.  Go to **Classes**.
3.  Find the class (e.g., "JS1D").
4.  Click the **Trash (Delete)** icon.
5.  A modal appears asking: "Are you sure you want to delete JS1D?".
6.  Click **Yes, Delete**.
7.  *Result:* The class is removed, and the schedule is cleared for that entry.

### **Scenario C: Teacher Requesting a Swap**
1.  **Login** as Teacher.
2.  Go to **Timetables** (the book icon).
3.  Filter for a specific class.
4.  Click on a slot you want (e.g., Monday Period 1).
5.  Select a lesson of yours to swap with it.
6.  Click **Send Proposal**.
7.  *Result:* The Admin receives a notification and can Approve/Reject in the **Requests** tab.

---

## 🛠️ Technical Notes

*   **Offline Mode:** The app works without internet. Data is synced to `localStorage`.
*   **Live Sync:** If you open the app in two tabs (e.g., one Admin, one Teacher), changes in one will instantly reflect in the other, simulating a real-time database.
*   **AI Integration:** The system uses Google Gemini for logic analysis and chat moderation. Ensure the API Key is valid in the source code if these features stop working.
