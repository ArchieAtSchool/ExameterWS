const { Server } = require("socket.io");

// Pass the configuration options directly without an HTTP server object
const io = new Server({
  pingInterval: 2000, 
  pingTimeout: 2000,   
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  socket.on("join-exam", ({ examId, studentId, studentName }) => {
    socket.join(`exam-${examId}`);
    socket.studentData = { examId, studentId, studentName };
    console.log(`${studentName} connected.`);
  });

  socket.on("disconnect", (reason) => {
    if (!socket.studentData) return;
    const { examId, studentName, studentId } = socket.studentData;
    io.to(`exam-${examId}-teachers`).emit("student-connection-lost", {
      studentId,
      studentName,
      reason,
      timestamp: new Date()
    });
  });
});

// Instruct Socket.IO to bind directly to Render's assigned port
const PORT = process.env.PORT || 3000;
io.listen(PORT);
console.log(`Socket.IO standalone server running on port ${PORT}`);
