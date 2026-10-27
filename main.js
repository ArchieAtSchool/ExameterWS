import { Server } from "socket.io";
import { createServer } from "http";
import express from "express";

const app = express();
const httpServer = createServer(app);

// Initialize Socket.io with strict CORS policies
const io = new Server(httpServer, {
  cors: {
    origin: ["https://your-school-portal.com"], // Restrict to your trusted domain
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Namespaces to isolate Student actions from Proctor controls
const studentsNamespace = io.of("/students");
const proctorsNamespace = io.of("/proctors");

// In-memory state tracking (Replace with Redis or Database for production scale)
const activeExams = new Map(); // examId -> { proctorSocketId, students: Map(studentId -> data) }

// ==========================================
// 1. PROCTOR NAMESPACE (Control & Monitoring)
// ==========================================
proctorsNamespace.on("connection", (socket) => {
  console.log(`Proctor connected: ${socket.id}`);

  // Proctor initializes an exam session
  socket.on("initialize_session", ({ examId }) => {
    socket.join(examId);
    if (!activeExams.has(examId)) {
      activeExams.set(examId, { proctorSocketId: socket.id, students: new Map() });
    } else {
      activeExams.get(examId).proctorSocketId = socket.id;
    }
    console.log(`Exam session ${examId} initialized by proctor.`);
  });

  // Proctor forces a specific student out of the exam
  socket.on("terminate_student", ({ examId, studentId, reason }) => {
    studentsNamespace.to(`student:${studentId}`).emit("force_terminate", { reason });
    console.log(`Proctor terminated student ${studentId} from exam ${examId}. Reason: ${reason}`);
  });

  // Proctor locks or unlocks the entire exam for everyone
  socket.on("toggle_exam_lock", ({ examId, isLocked }) => {
    studentsNamespace.to(examId).emit("lock_state_changed", { isLocked });
  });

  socket.on("disconnect", () => {
    console.log(`Proctor disconnected: ${socket.id}`);
  });
});

// ==========================================
// 2. STUDENT NAMESPACE (Proctoring Target)
// ==========================================
studentsNamespace.on("connection", (socket) => {
  let currentStudentId = null;
  let currentExamId = null;

  // Student registers entry into an exam
  socket.on("join_exam", ({ examId, studentId, studentName }) => {
    currentStudentId = studentId;
    currentExamId = examId;

    // Put student into a room for the specific exam, and a private room for direct commands
    socket.join(examId);
    socket.join(`student:${studentId}`);

    const session = activeExams.get(examId);
    if (session) {
      const studentData = { id: studentId, name: studentName, status: "active", violations: [] };
      session.students.set(studentId, studentData);

      // Notify the proctor dashboard that a student entered
      proctorsNamespace.to(examId).emit("student_joined", studentData);
    }
  });

  // Handle browser integrity/telemetry violations (Tab switch, resizing, blur)
  socket.on("integrity_violation", ({ type, details }) => {
    if (!currentExamId || !currentStudentId) return;

    const session = activeExams.get(currentExamId);
    if (session && session.students.has(currentStudentId)) {
      const student = session.students.get(currentStudentId);
      const logEntry = { type, timestamp: new Date().toISOString(), details };
      
      student.violations.push(logEntry);

      // Alert the proctor dynamically in real-time
      proctorsNamespace.to(currentExamId).emit("student_violation_alert", {
        studentId: currentStudentId,
        violation: logEntry
      });
      
      console.warn(`[VIOLATION] Student ${currentStudentId} triggered: ${type}`);
    }
  });

  // Periodic heartbeat tracking network connectivity status
  socket.on("heartbeat", (data) => {
    proctorsNamespace.to(currentExamId).emit("student_heartbeat", {
      studentId: currentStudentId,
      ...data
    });
  });

  socket.on("disconnect", () => {
    if (currentExamId && currentStudentId) {
      const session = activeExams.get(currentExamId);
      if (session && session.students.has(currentStudentId)) {
        session.students.get(currentStudentId).status = "offline";
      }
      // Warn proctor that student disconnected abruptly (could be closing tab or network drop)
      proctorsNamespace.to(currentExamId).emit("student_left", { studentId: currentStudentId });
    }
    console.log(`Student disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Secure Proctor Server running on port ${PORT}`);
});
