const { Server } = require("socket.io");

// Global memory state tracker (In production, mirror or migrate this to Redis/Database)
const examStates = {}; 

const io = new Server(server, {
  pingInterval: 5000, 
  pingTimeout: 4000,   
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  // ==========================================
  // 1. STUDENT REGISTRATION
  // ==========================================
  socket.on("join-exam", ({ examId, studentId, studentName }) => {
    // Check if the exam is currently hard-locked by a teacher
    if (examStates[examId] && examStates[examId].isLocked) {
      return socket.emit("exam-error", { 
        message: "This exam is currently locked by the invigilator. Entry denied." 
      });
    }

    const studentRoom = `exam-${examId}`;
    socket.join(studentRoom);
    
    // Attach credentials safely to this persistent connection instance
    socket.userData = { role: "student", examId, studentId, studentName };
    
    console.log(`Student [${studentName}] entered exam room: ${studentRoom}`);
    
    // Broadcast student activity feed instantly to the teacher's security monitor
    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: "STUDENT_JOINED",
      studentId,
      studentName,
      timestamp: new Date()
    });
  });

  // ==========================================
  // 2. TEACHER REGISTRATION & CONTROLS
  // ==========================================
  socket.on("teacher-join", ({ examId, teacherId }) => {
    const teacherRoom = `exam-${examId}-teachers`;
    socket.join(teacherRoom);
    
    // Elevate role credentials to protect administrative namespaces
    socket.userData = { role: "teacher", examId, teacherId };
    
    // Initialize exam tracking container state if it doesn't exist yet
    if (!examStates[examId]) {
      examStates[examId] = { isLocked: false, isActive: true };
    }

    console.log(`Teacher [${teacherId}] connected to control panel for exam: ${examId}`);
    
    // Send the current baseline status back to the freshly connected teacher
    socket.emit("exam-status-update", examStates[examId]);
  });

  // Teacher Action: Lock or Unlock Exam Entry Gates
  socket.on("teacher-toggle-lock", ({ examId, lockStatus }) => {
    // Security check: Verify the emitting socket is actually an authorized teacher
    if (!socket.userData || socket.userData.role !== "teacher" || socket.userData.examId !== examId) {
      return socket.emit("exam-error", { message: "Unauthorized operation." });
    }

    if (!examStates[examId]) examStates[examId] = {};
    examStates[examId].isLocked = lockStatus;

    console.log(`Exam [${examId}] lock state changed to: ${lockStatus}`);

    // Update all managing teachers watching this exam channel
    io.to(`exam-${examId}-teachers`).emit("exam-status-update", examStates[examId]);
    
    // Log lock event tracking
    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: lockStatus ? "EXAM_LOCKED" : "EXAM_UNLOCKED",
      timestamp: new Date()
    });
  });

  // Teacher Action: Terminate Exam or Force Submit All
  socket.on("teacher-force-submit", ({ examId }) => {
    if (!socket.userData || socket.userData.role !== "teacher") return;

    console.log(`Teacher initiated forced close out for exam: ${examId}`);

    // Evict all students from the active canvas by emitting a critical action event
    io.to(`exam-${examId}`).emit("exam-force-closed-by-teacher", {
      timestamp: new Date()
    });
    
    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: "EXAM_TERMINATED_BY_TEACHER",
      timestamp: new Date()
    });
  });

  // ==========================================
  // 3. STUDENT TELEMETRY & BEHAVIOUR EVENTS
  // ==========================================
  // Catch cheat attempts like shifting tabs or escaping full-screen mode
  socket.on("student-activity", ({ eventType }) => {
    if (!socket.userData || socket.userData.role !== "student") return;

    const { examId, studentId, studentName } = socket.userData;

    // Direct telemetry routing straight to the teacher stream
    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: eventType, // e.g., "TAB_BLUR" (Left tab), "FULLSCREEN_EXIT"
      studentId,
      studentName,
      timestamp: new Date()
    });
  });

  // ==========================================
  // 4. DISCONNECT / DROPOUT MONITORING
  // ==========================================
  socket.on("disconnect", (reason) => {
    if (!socket.userData) return;

    const { role, examId } = socket.userData;

    if (role === "student") {
      const { studentId, studentName } = socket.userData;
      console.log(`Alert: Student [${studentName}] connection broken.`);

      io.to(`exam-${examId}-teachers`).emit("live-event", {
        type: "CONNECTION_LOST",
        studentId,
        studentName,
        reason: reason,
        timestamp: new Date()
      });
    }
  });
});
