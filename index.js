const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let sharedCode = ""; // Store the editor's code
let users = [];

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // When a client sets its username
  socket.on("setUsername", (username) => {
    console.log("Username set:", username);
    socket.username = username;
    users.push(username);
    io.emit("updateUsers", users);
  });

  // Receive code updates and broadcast to others
  socket.on("codeUpdate", (code) => {
    console.log("Code updated:", code);
    sharedCode = code;
    socket.broadcast.emit("updateCode", code);
  });

  // Receive chat messages and broadcast them
  socket.on("chatMessage", (msg) => {
    console.log(`Chat message from ${socket.username}: ${msg}`);
    const messageToSend = `<strong>${socket.username}:</strong> ${msg}`;
    io.emit("newMessage", messageToSend);
  });

  // AI Suggestion integration: receive code and return a dummy recommendation
  socket.on("aiSuggest", (code) => {
    console.log("AI suggestion requested for code length:", code.length);
    // Simulate processing delay and then send back a suggestion
    setTimeout(() => {
      const suggestion = "\n// AI Suggestion: Consider using arrow functions for a more concise syntax.\n";
      socket.emit("aiSuggestionResult", suggestion);
    }, 1000);
  });

  // On disconnect, update the user list
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (socket.username) {
      users = users.filter(user => user !== socket.username);
      io.emit("updateUsers", users);
    }
  });
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve our main HTML file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Gcode.html"));
});

// Start the server on port 3000
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
