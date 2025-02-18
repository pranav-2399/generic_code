require("dotenv").config();
const rawKey = process.env.GEMINI_API_KEY;
const GEMINI_API_KEY = rawKey && rawKey.startsWith("sk-") ? rawKey.substring(3) : rawKey;
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { spawn } = require("child_process");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent";

if (!GEMINI_API_KEY) {
  console.warn("Warning: Please set your GEMINI_API_KEY environment variable with a valid API key.");
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Gcode.html"));
});

const repoHistoryFile = path.join(__dirname, "repoHistory.json");
let repoHistory = [];
if (fs.existsSync(repoHistoryFile)) {
  try {
    const data = fs.readFileSync(repoHistoryFile, "utf8");
    repoHistory = JSON.parse(data);
  } catch (err) {
    console.error("Error reading repoHistory file:", err);
  }
} else {
  repoHistory = [];
}
function saveRepoHistory() {
  fs.writeFileSync(repoHistoryFile, JSON.stringify(repoHistory, null, 2));
}

let users = [];

io.on("connection", (socket) => {
  console.log("A user connected");
  
  socket.on("setUsername", (username) => {
    socket.username = username;
    if (!users.includes(username)) {
      users.push(username);
    }
    io.emit("userList", users);
  });
  
  socket.on("sendMessage", (data) => {
    io.emit("chatMessage", data);
  });
  
  socket.on("aiSuggestion", async (data) => {
    const { code, language } = data;
    try {
      const response = await axios.post(
        `${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`,
        { 
          contents: [{ parts: [{ text: `Suggest improvements for the following ${language} code:\n\n${code}` }] }] 
        },
        { headers: { "Content-Type": "application/json" } }
      );
      const suggestion = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No suggestion received.";
      socket.emit("aiSuggestion", suggestion);
    } catch (error) {
      console.error("Error getting AI suggestion:", error.response?.data || error.message);
      socket.emit("aiSuggestion", "Failed to get AI suggestion");
    }
  });
  
  socket.on("aiCorrection", async (data) => {
    const { code, language } = data;
    try {
      const prompt = `Analyze and correct the following ${language} code snippet. Fix any syntax errors, improve formatting, and apply best practices. Return only the corrected code as plain text without any explanations, commentary, markdown formatting, or code fences.\n\n${code}`;
      const response = await axios.post(
        `${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { "Content-Type": "application/json" } }
      );
      const correctedCode = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No correction received.";
      socket.emit("aiCorrection", correctedCode);
    } catch (error) {
      console.error("Error getting AI correction:", error.response?.data || error.message);
      socket.emit("aiCorrection", "Failed to get AI correction");
    }
  });
  
  socket.on("runCode", (data) => {
    const { code, language, input } = data;
    const id = socket.id;
    let filename, command, args;
    if (language === "javascript") {
      filename = `code-${id}.js`;
      command = "node";
      args = [filename];
    } else if (language === "python") {
      filename = `code-${id}.py`;
      command = "python3";
      args = [filename];
    } else if (language === "swift") {
      filename = `code-${id}.swift`;
      command = "swift";
      args = [filename];
    } else if (language === "c") {
      filename = `code-${id}.c`; 
      const executable = `code-${id}`;
      fs.writeFileSync(filename, code);
      const compile = spawn("gcc", [filename, "-o", executable]);
      let compileError = "";
      compile.stderr.on("data", (data) => { compileError += data.toString(); });
      compile.on("close", (exitCode) => {
        if (exitCode !== 0) {
          socket.emit("runtimeErrors", `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn(`./${executable}`);
          let output = "", errOutput = "";
          child.stdout.on("data", (data) => { output += data.toString(); });
          child.stderr.on("data", (data) => { errOutput += data.toString(); });
          child.on("close", () => {
            let combined = output;
            if(errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit("runtimeErrors", combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) { child.stdin.write(input); child.stdin.end(); }
        }
      });
      return;
    } else if (language === "csharp") {
      filename = `code-${id}.cs`; 
      const executable = `code-${id}.exe`;
      fs.writeFileSync(filename, code);
      const compile = spawn("mcs", [filename, "-out:" + executable]);
      let compileError = "";
      compile.stderr.on("data", (data) => { compileError += data.toString(); });
      compile.on("close", (exitCode) => {
        if (exitCode !== 0) {
          socket.emit("runtimeErrors", `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn("mono", [executable]);
          let output = "", errOutput = "";
          child.stdout.on("data", (data) => { output += data.toString(); });
          child.stderr.on("data", (data) => { errOutput += data.toString(); });
          child.on("close", () => {
            let combined = output;
            if(errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit("runtimeErrors", combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) { child.stdin.write(input); child.stdin.end(); }
        }
      });
      return;
    } else if (language === "java") {
      filename = `Main.java`;
      fs.writeFileSync(filename, code);
      const compile = spawn("javac", [filename]);
      let compileError = "";
      compile.stderr.on("data", (data) => { compileError += data.toString(); });
      compile.on("close", (exitCode) => {
        if (exitCode !== 0) {
          socket.emit("runtimeErrors", `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn("java", ["Main"]);
          let output = "", errOutput = "";
          child.stdout.on("data", (data) => { output += data.toString(); });
          child.stderr.on("data", (data) => { errOutput += data.toString(); });
          child.on("close", () => {
            let combined = output;
            if(errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit("runtimeErrors", combined);
            fs.unlink(filename, () => {});
            fs.unlink("Main.class", () => {});
          });
          if (input) { child.stdin.write(input); child.stdin.end(); }
        }
      });
      return;
    } else if (language === "cpp") {
      filename = `code-${id}.cpp`; 
      const executable = `code-${id}`;
      fs.writeFileSync(filename, code);
      const compile = spawn("g++", [filename, "-o", executable]);
      let compileError = "";
      compile.stderr.on("data", (data) => { compileError += data.toString(); });
      compile.on("close", (exitCode) => {
        if (exitCode !== 0) {
          socket.emit("runtimeErrors", `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn(`./${executable}`);
          let output = "", errOutput = "";
          child.stdout.on("data", (data) => { output += data.toString(); });
          child.stderr.on("data", (data) => { errOutput += data.toString(); });
          child.on("close", () => {
            let combined = output;
            if(errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit("runtimeErrors", combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) { child.stdin.write(input); child.stdin.end(); }
        }
      });
      return;
    } else { 
      socket.emit("runtimeErrors", "Unsupported language.");
      return;
    }
    fs.writeFileSync(filename, code);
    const child = spawn(command, args);
    let output = "", errOutput = "";
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { errOutput += data.toString(); });
    child.on("close", () => { 
      let combined = output; 
      if(errOutput) combined += `\nErrors:\n${errOutput}`; 
      socket.emit("runtimeErrors", combined); 
      fs.unlink(filename, () => {}); 
    });
    if (input) { child.stdin.write(input); child.stdin.end(); }
  });
  
  socket.on("saveRepo", (data) => {
    const { code, filePath } = data;
    const entry = {
      code,
      filePath,
      timestamp: new Date(),
      savedBy: socket.username || "Unknown"
    };
    repoHistory.push(entry);
    saveRepoHistory();
    socket.emit("repoSaved", "Code saved to repo successfully.");
  });
  
  socket.on("sendCode", (data) => {
    const { code, recipients } = data;
    const sender = socket.username || "Anonymous";
    for (const [id, s] of io.of("/").sockets) {
      if (recipients.includes(s.username)) {
        s.emit("receivedCode", { from: sender, code });
      }
    }
  });
  
  socket.on("disconnect", () => {
    console.log("A user disconnected");
    if (socket.username) { 
      users = users.filter(u => u !== socket.username); 
      io.emit("userList", users); 
    }
  });
});

app.get("/history", (req, res) => {
  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Repository History</title>
    <style>
      body { background: #000; color: #fff; font-family: 'Roboto Mono', monospace; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
      h1 { text-align: center; }
      .history-list { list-style: none; padding: 0; }
      .history-list li { padding: 10px; border-bottom: 1px solid #444; }
      .history-list li a { color: #fff; text-decoration: none; }
      .history-list li a:hover { text-decoration: underline; }
      .delete-link { color: red; margin-left: 10px; text-decoration: none; }
      .delete-link:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Repository History</h1>
      <ul class="history-list">`;
  repoHistory.forEach((entry, i) => {
    html += `<li>
      <a href="/history/${i}" target="_blank">
        ${entry.filePath} (${new Date(entry.timestamp).toLocaleString()})
      </a>
      <span> — Saved by: ${entry.savedBy || "Unknown"}</span>
      <a class="delete-link" href="/deleteRepo/${i}" onclick="return confirm('Are you sure you want to permanently delete this repo entry?');">[Delete]</a>
    </li>`;
  });
  html += `
      </ul>
    </div>
  </body>
  </html>
  `;
  res.send(html);
});

app.get("/history/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(isNaN(id) || id < 0 || id >= repoHistory.length){ 
    res.status(404).send("Not found"); 
    return; 
  }
  const entry = repoHistory[id];
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;");
  }
  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>${entry.filePath} History</title>
    <style>
      body { background: #000; color: #fff; font-family: 'Roboto Mono', monospace; margin: 0; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
      h1 { text-align: center; margin-bottom: 20px; }
      .code-box { background: #111; padding: 20px; border-radius: 8px; position: relative; white-space: pre-wrap; word-wrap: break-word; }
      pre { margin: 0; }
      .copy-button { position: absolute; top: 10px; right: 10px; background: #333; color: #fff; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px; }
      .copy-button:hover { background: #444; }
      .copy-notification { position: absolute; top: 10px; right: 80px; background: #333; padding: 5px 10px; border-radius: 4px; opacity: 0; transition: opacity 0.5s; display: none; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>${entry.filePath} — Saved by ${entry.savedBy || "Unknown"} (${new Date(entry.timestamp).toLocaleString()})</h1>
      <div class="code-box">
        <pre id="codeText">${escapeHtml(entry.code)}</pre>
        <button class="copy-button" id="copyButton">Copy</button>
        <div class="copy-notification" id="copyNotification">Copied!</div>
      </div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const copyButton = document.getElementById('copyButton');
        const copyNotification = document.getElementById('copyNotification');
        const codeText = document.getElementById('codeText');

        copyButton.addEventListener('click', function() {
          const text = codeText.innerText;
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(function() {
              showCopyNotification();
            }).catch(function(err) {
              console.error('Failed to copy text: ', err);
              fallbackCopyText(text);
            });
          } else {
            fallbackCopyText(text);
          }
        });

        function fallbackCopyText(text) {
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'absolute';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            showCopyNotification();
          } catch (err) {
            console.error('Fallback: Unable to copy', err);
          }
          document.body.removeChild(textArea);
        }

        function showCopyNotification() {
          copyNotification.style.display = "block";
          copyNotification.style.opacity = 1;
          setTimeout(() => {
            copyNotification.style.opacity = 0;
            setTimeout(() => { copyNotification.style.display = "none"; }, 500);
          }, 1500);
        }
      });
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

app.get("/deleteRepo/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if(isNaN(id) || id < 0 || id >= repoHistory.length){
    res.status(404).send("Not found");
    return;
  }
  repoHistory.splice(id, 1);
  saveRepoHistory();
  res.redirect("/history");
});

server.listen(3000, "0.0.0.0", () => {
  console.log("Server running on http://172.16.44.186:3000");
});
