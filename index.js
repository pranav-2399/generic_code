const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let sharedCode = "";  // We'll store the single editor's code here
let users = [];

// When a new client connects
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Set the username for the socket
  socket.on("setUsername", (username) => {
    console.log("Username set:", username);
    socket.username = username;
    users.push(username);
    io.emit("updateUsers", users);
  });

  // Listen for code updates
  socket.on("codeUpdate", (code) => {
    console.log("Code updated:", code);
    sharedCode = code;
    // Broadcast the code to all other connected clients (except the sender)
    socket.broadcast.emit("updateCode", code);
  });

  // Listen for chat messages
  socket.on("chatMessage", (msg) => {
    console.log(`Chat message from ${socket.username}: ${msg}`);
    // Include the username in the message for display
    const messageToSend = `<strong>${socket.username}:</strong> ${msg}`;
    // Emit to all clients (including sender)
    io.emit("newMessage", messageToSend);
  });

  // When a user disconnects
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.username) {
      users = users.filter((user) => user !== socket.username);
      io.emit("updateUsers", users);
    }
  });
});

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve the HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Gcode.html"));
});

// Start the server
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
