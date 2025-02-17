require('dotenv').config(); // Load environment variables

// Remove "sk-" prefix if present so that the key is in the correct format
const rawKey = process.env.GEMINI_API_KEY;
const GEMINI_API_KEY = rawKey && rawKey.startsWith('sk-') ? rawKey.substring(3) : rawKey;

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent';

if (!GEMINI_API_KEY) {
  console.warn("Warning: Please set your GEMINI_API_KEY environment variable with a valid API key.");
}

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'Gcode.html'));
});

let users = [];

io.on('connection', (socket) => {
  console.log('A user connected');

  socket.on('setUsername', (username) => {
    socket.username = username;
    if (!users.includes(username)) {
      users.push(username);
    }
    io.emit('userList', users);
  });

  socket.on('sendMessage', (data) => {
    io.emit('chatMessage', data);
  });

  socket.on('aiSuggestion', async (data) => {
    const { code, language } = data;
    try {
      const response = await axios.post(
        `${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`,
        {
          contents: [{ parts: [{ text: `Suggest improvements for the following ${language} code:\n\n${code}` }] }],
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
      const suggestion = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No suggestion received.";
      socket.emit('aiSuggestion', suggestion);
    } catch (error) {
      console.error('Error getting AI suggestion:', error.response?.data || error.message);
      socket.emit('aiSuggestion', 'Failed to get AI suggestion');
    }
  });

  socket.on('aiCorrection', async (data) => {
    const { code, language } = data;
    try {
      // Instruct AI to return only the corrected code without any commentary.
      const response = await axios.post(
        `${GEMINI_API_ENDPOINT}?key=${GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [{
              text: `Please provide only the corrected ${language} code (with no explanations or commentary):\n\n${code}`
            }]
          }],
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
      const correctedCode = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No correction received.";
      socket.emit('aiCorrection', correctedCode);
    } catch (error) {
      console.error('Error getting AI correction:', error.response?.data || error.message);
      socket.emit('aiCorrection', 'Failed to get AI correction');
    }
  });

  // Handler for running/compiling code
  socket.on('runCode', (data) => {
    const { code, language, input } = data;
    const id = socket.id; // Use socket id to avoid filename collisions
    let filename, command, args;

    if (language === 'javascript') {
      filename = `code-${id}.js`;
      command = 'node';
      args = [filename];
    } else if (language === 'python') {
      filename = `code-${id}.py`;
      command = 'python3';
      args = [filename];
    } else if (language === 'swift') {
      filename = `code-${id}.swift`;
      command = 'swift';
      args = [filename];
    } else if (language === 'c') {
      filename = `code-${id}.c`;
      const executable = `code-${id}`;
      fs.writeFileSync(filename, code);
      const compile = spawn('gcc', [filename, '-o', executable]);
      let compileError = '';
      compile.stderr.on('data', (data) => {
        compileError += data.toString();
      });
      compile.on('close', (compileExitCode) => {
        if (compileExitCode !== 0) {
          socket.emit('runtimeErrors', `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn(`./${executable}`);
          let output = '';
          let errOutput = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { errOutput += data.toString(); });
          child.on('close', () => {
            let combined = output;
            if (errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit('runtimeErrors', combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) {
            child.stdin.write(input);
            child.stdin.end();
          }
        }
      });
      return;
    } else if (language === 'csharp') {
      filename = `code-${id}.cs`;
      const executable = `code-${id}.exe`;
      fs.writeFileSync(filename, code);
      const compile = spawn('mcs', [filename, '-out:' + executable]);
      let compileError = '';
      compile.stderr.on('data', (data) => { compileError += data.toString(); });
      compile.on('close', (compileExitCode) => {
        if (compileExitCode !== 0) {
          socket.emit('runtimeErrors', `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn('mono', [executable]);
          let output = '';
          let errOutput = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { errOutput += data.toString(); });
          child.on('close', () => {
            let combined = output;
            if (errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit('runtimeErrors', combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) {
            child.stdin.write(input);
            child.stdin.end();
          }
        }
      });
      return;
    } else if (language === 'java') {
      // For Java, expect the code to contain a public class "Main"
      filename = `Main.java`;
      fs.writeFileSync(filename, code);
      const compile = spawn('javac', [filename]);
      let compileError = '';
      compile.stderr.on('data', (data) => { compileError += data.toString(); });
      compile.on('close', (compileExitCode) => {
        if (compileExitCode !== 0) {
          socket.emit('runtimeErrors', `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn('java', ['Main']);
          let output = '';
          let errOutput = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { errOutput += data.toString(); });
          child.on('close', () => {
            let combined = output;
            if (errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit('runtimeErrors', combined);
            fs.unlink(filename, () => {});
            fs.unlink('Main.class', () => {});
          });
          if (input) {
            child.stdin.write(input);
            child.stdin.end();
          }
        }
      });
      return;
    } else if (language === 'cpp') {
      filename = `code-${id}.cpp`;
      const executable = `code-${id}`;
      fs.writeFileSync(filename, code);
      const compile = spawn('g++', [filename, '-o', executable]);
      let compileError = '';
      compile.stderr.on('data', (data) => {
        compileError += data.toString();
      });
      compile.on('close', (compileExitCode) => {
        if (compileExitCode !== 0) {
          socket.emit('runtimeErrors', `Compilation Error:\n${compileError}`);
          fs.unlink(filename, () => {});
        } else {
          const child = spawn(`./${executable}`);
          let output = '';
          let errOutput = '';
          child.stdout.on('data', (data) => { output += data.toString(); });
          child.stderr.on('data', (data) => { errOutput += data.toString(); });
          child.on('close', () => {
            let combined = output;
            if (errOutput) combined += `\nErrors:\n${errOutput}`;
            socket.emit('runtimeErrors', combined);
            fs.unlink(filename, () => {});
            fs.unlink(executable, () => {});
          });
          if (input) {
            child.stdin.write(input);
            child.stdin.end();
          }
        }
      });
      return;
    } else {
      socket.emit('runtimeErrors', "Unsupported language.");
      return;
    }

    // For interpreted languages (JavaScript, Python, Swift):
    fs.writeFileSync(filename, code);
    const child = spawn(command, args);
    let output = '';
    let errOutput = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { errOutput += data.toString(); });
    child.on('close', () => {
      let combined = output;
      if (errOutput) combined += `\nErrors:\n${errOutput}`;
      socket.emit('runtimeErrors', combined);
      fs.unlink(filename, () => {});
    });
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });

  // Handler for sending code to specific users
  socket.on('sendCode', (data) => {
    const { code, recipients } = data;
    const sender = socket.username || "Anonymous";
    // Iterate over all connected sockets and send code to those whose username is in recipients
    for (const [id, s] of io.of("/").sockets) {
      if (recipients.includes(s.username)) {
        s.emit("receivedCode", { from: sender, code });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected');
    if (socket.username) {
      users = users.filter((user) => user !== socket.username);
      io.emit('userList', users);
    }
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
