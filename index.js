// Required dependencies
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { exec } = require('child_process');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Create an Express application
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Custom route to serve Gcode.html at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'Gcode.html'));
});

// Store the list of users
let users = [];

// Socket.IO connection event
io.on('connection', (socket) => {
  console.log('a user connected');

  // When a user joins, save and broadcast the username
  socket.on('setUsername', (username) => {
    socket.username = username;
    if (!users.includes(username)) {
      users.push(username);
    }
    io.emit('userList', users);
  });

  // Broadcast chat messages
  socket.on('sendMessage', (data) => {
    io.emit('chatMessage', data);
  });

  // AI Suggestion event – suggests improvements for the given code
  socket.on('aiSuggestion', async (data) => {
    const { code, language } = data;
    try {
      const prompt = `Suggest improvements for the following ${language} code:\n\n${code}`;
      const response = await axios.post(
        'https://api.openai.com/v1/completions',
        {
          model: 'text-davinci-003',
          prompt: prompt,
          max_tokens: 100,
          temperature: 0.7,
        },
        {
          headers: {
            'Authorization': `Bearer YOUR_OPENAI_API_KEY`,
          },
        }
      );
      const suggestion = response.data.choices[0].text.trim();
      socket.emit('aiSuggestion', suggestion);
    } catch (error) {
      console.error('Error getting AI suggestion:', error);
      socket.emit('aiSuggestion', 'Failed to get AI suggestion');
    }
  });

  // AI Correction event – returns a corrected version of the code
  socket.on('aiCorrection', async (data) => {
    const { code, language } = data;
    try {
      const prompt = `Please correct any syntax errors and improve the following ${language} code:\n\n${code}`;
      const response = await axios.post(
        'https://api.openai.com/v1/completions',
        {
          model: 'text-davinci-003',
          prompt: prompt,
          max_tokens: 150,
          temperature: 0.2,
        },
        {
          headers: {
            'Authorization': `Bearer YOUR_OPENAI_API_KEY`,
          },
        }
      );
      const correctedCode = response.data.choices[0].text.trim();
      socket.emit('aiCorrection', correctedCode);
    } catch (error) {
      console.error('Error getting AI correction:', error);
      socket.emit('aiCorrection', 'Failed to get AI correction');
    }
  });

  // Run Code event – executes the code based on the selected language
  socket.on('runCode', (data) => {
    const { code, language } = data;
    if (language === 'javascript') {
      exec(`node -e ${JSON.stringify(code)}`, (error, stdout, stderr) => {
        if (error) {
          socket.emit('runtimeErrors', `Error: ${stderr}`);
        } else {
          socket.emit('runtimeErrors', stdout);
        }
      });
    } else if (language === 'python') {
      exec(`python -c ${JSON.stringify(code)}`, (error, stdout, stderr) => {
        if (error) {
          socket.emit('runtimeErrors', `Error: ${stderr}`);
        } else {
          socket.emit('runtimeErrors', stdout);
        }
      });
    } else if (language === 'c') {
      // Write code to a temporary file
      const filename = path.join(__dirname, 'temp_code.c');
      fs.writeFileSync(filename, code);
      // Determine executable name (adjust for Windows)
      const executableName = process.platform === "win32" ? "temp_executable.exe" : "temp_executable";
      // Compile the C code using gcc
      exec(`gcc ${filename} -o ${executableName}`, (compilationError, stdout, stderr) => {
        if (compilationError) {
          socket.emit('runtimeErrors', `Compilation Error: ${stderr}`);
          fs.unlinkSync(filename);
        } else {
          const execCommand = process.platform === "win32" ? executableName : `./${executableName}`;
          // Run the compiled executable
          exec(execCommand, (runtimeError, stdout, stderr) => {
            if (runtimeError) {
              socket.emit('runtimeErrors', `Runtime Error: ${stderr}`);
            } else {
              socket.emit('runtimeErrors', stdout);
            }
            // Clean up temporary files
            fs.unlinkSync(filename);
            fs.unlinkSync(path.join(__dirname, executableName));
          });
        }
      });
    } else {
      socket.emit('runtimeErrors', 'Unsupported language');
    }
  });

  // Handle user disconnect
  socket.on('disconnect', () => {
    console.log('a user disconnected');
    if (socket.username) {
      users = users.filter((user) => user !== socket.username);
      io.emit('userList', users);
    }
  });
});

// Start the server on port 3000
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
