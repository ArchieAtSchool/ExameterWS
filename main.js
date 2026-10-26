const { Server } = require("socket.io");

// Pass the port number directly (e.g., 3000) instead of an undefined "server" variable
const io = new Server(3000, {
  pingInterval: 5000, 
  pingTimeout: 4000,   
  cors: { origin: "*" }
});

console.log("Socket.IO server listening internally on port 3000");

// Global memory state tracker
const examStates = {}; 

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  
  // ==========================================
  // 1. STUDENT REGISTRATION
  // ==========================================
  socket.on("join-exam", ({ examId, studentId, studentName }) => {
    if (examStates[examId] && examStates[examId].isLocked) {
      return socket.emit("exam-error", { 
        message: "This exam is currently locked by the invigilator. Entry denied." 
      });
    }

    const studentRoom = `exam-${examId}`;
    socket.join(studentRoom);
    
    socket.userData = { role: "student", examId, studentId, studentName };
    console.log(`Student [${studentName}] entered exam room: ${studentRoom}`);
    
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
    
    socket.userData = { role: "teacher", examId, teacherId };
    
    if (!examStates[examId]) {
      examStates[examId] = { isLocked: false, isActive: true };
    }

    console.log(`Teacher [${teacherId}] connected to control panel for exam: ${examId}`);
    socket.emit("exam-status-update", examStates[examId]);
  });

  socket.on("teacher-toggle-lock", ({ examId, lockStatus }) => {
    if (!socket.userData || socket.userData.role !== "teacher" || socket.userData.examId !== examId) {
      return socket.emit("exam-error", { message: "Unauthorized operation." });
    }

    if (!examStates[examId]) examStates[examId] = {};
    examStates[examId].isLocked = lockStatus;

    console.log(`Exam [${examId}] lock state changed to: ${lockStatus}`);

    io.to(`exam-${examId}-teachers`).emit("exam-status-update", examStates[examId]);
    
    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: lockStatus ? "EXAM_LOCKED" : "EXAM_UNLOCKED",
      timestamp: new Date()
    });
  });

  socket.on("teacher-force-submit", ({ examId }) => {
    if (!socket.userData || socket.userData.role !== "teacher") return;

    console.log(`Teacher initiated forced close out for exam: ${examId}`);

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
  socket.on("student-activity", ({ eventType }) => {
    if (!socket.userData || socket.userData.role !== "student") return;

    const { examId, studentId, studentName } = socket.userData;

    io.to(`exam-${examId}-teachers`).emit("live-event", {
      type: eventType, 
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
