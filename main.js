const { Server } = require("socket.io");

const io = new Server(server, {
  // Check the client connection every 2 seconds
  pingInterval: 2000, 
  // If the client doesn't reply within 2 seconds, consider them disconnected
  pingTimeout: 2000,   
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  
  socket.on("join-exam", ({ examId, studentId, studentName }) => {
    socket.join(`exam-${examId}`);
    
    // Store identification data directly on the socket instance
    socket.studentData = { examId, studentId, studentName };
    
    // Mark them as active/connected in your server-side state or cache
    console.log(`${studentName} connected.`);
  });

  // Native event: Triggers automatically the moment a connection is dropped
  socket.on("disconnect", (reason) => {
    // If the student hasn't joined an exam yet, do nothing
    if (!socket.studentData) return;

    const { examId, studentName, studentId } = socket.studentData;

    // Instantly alert the teachers in that exam room
    io.to(`exam-${examId}-teachers`).emit("student-connection-lost", {
      studentId,
      studentName,
      reason: reason, // e.g., "ping timeout", "transport close", or "client namespace disconnect"
      timestamp: new Date()
    });
  });
});
