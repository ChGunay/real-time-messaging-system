import { createApp, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

createApp({
  setup() {
    const username = ref('');
    const email = ref('');
    const password = ref('');
    const token = ref('');
    const socketStatus = ref('Disconnected');
    const conversationId = ref('');
    const messageContent = ref('');
    const messages = ref([]);
    const logs = ref([]);
    let socket = null;

    const log = (msg, type = 'info') => {
      const time = new Date().toLocaleTimeString();
      logs.value.push({ msg, type, time });
    };

    const addMessage = (text, type = 'msg') => {
      const time = new Date().toLocaleTimeString();
      messages.value.push({ text, type, time });
    };

    const register = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value, email: email.value, password: password.value })
        });
        const data = await res.json();
        if (data.success) {
          token.value = data.data.tokens.accessToken;
          log('Registration completed', 'success');
        } else {
          log('Registration failed: ' + data.message, 'error');
        }
      } catch (err) {
        log('Registration error: ' + err.message, 'error');
      }
    };

    const login = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.value, password: password.value })
        });
        const data = await res.json();
        if (data.success) {
          token.value = data.data.tokens.accessToken;
          log('Login successful', 'success');
        } else {
          log('Login failed: ' + data.message, 'error');
        }
      } catch (err) {
        log('Login error: ' + err.message, 'error');
      }
    };

    const connectSocket = () => {
      if (socket) return;
      if (!token.value) {
        log('Token required', 'error');
        return;
      }
      socket = io('http://localhost:3000', { auth: { token: token.value } });

      socket.on('connect', () => {
        socketStatus.value = 'Connected';
        log('Socket connected', 'success');
      });

      socket.on('disconnect', () => {
        socketStatus.value = 'Disconnected';
        log('Socket disconnected', 'info');
      });

      socket.on('connection_error', d => {
        log('Connection error: ' + d.message, 'error');
      });

      socket.on('message_received', data => {
        addMessage(`${data.message.content} (from ${data.message.sender.username})`);
      });

      socket.on('online_users', d => {
        addMessage(`Online users: ${d.count}`, 'info');
      });
    };

    const disconnectSocket = () => {
      if (socket) {
        socket.disconnect();
        socket = null;
        socketStatus.value = 'Disconnected';
      }
    };

    const joinRoom = () => {
      if (socket && conversationId.value) {
        socket.emit('join_room', { conversationId: conversationId.value });
        log(`Joined ${conversationId.value}`, 'info');
      }
    };

    const sendMessage = () => {
      if (socket && conversationId.value && messageContent.value) {
        socket.emit('send_message', { conversationId: conversationId.value, content: messageContent.value });
        messageContent.value = '';
      }
    };

    return {
      username,
      email,
      password,
      token,
      socketStatus,
      conversationId,
      messageContent,
      messages,
      logs,
      register,
      login,
      connectSocket,
      disconnectSocket,
      joinRoom,
      sendMessage
    };
  },
  template: `
  <div class="container">
    <h1>Chat Client</h1>

    <div class="block">
      <h3>Auth</h3>
      <input v-model="username" placeholder="Username" />
      <input v-model="email" type="email" placeholder="Email" />
      <input v-model="password" type="password" placeholder="Password" />
      <div>
        <button @click="register">Register</button>
        <button @click="login">Login</button>
      </div>
      <input v-model="token" placeholder="Access token" style="width:100%;" />
      <div>
        <button @click="connectSocket">Connect</button>
        <button @click="disconnectSocket">Disconnect</button>
      </div>
      <div class="status">Socket: {{ socketStatus }}</div>
    </div>

    <div class="block">
      <h3>Conversation</h3>
      <input v-model="conversationId" placeholder="Conversation ID" />
      <button @click="joinRoom">Join</button>
      <textarea v-model="messageContent" rows="3"></textarea>
      <button @click="sendMessage">Send</button>
    </div>

    <div class="block">
      <h3>Messages</h3>
      <div class="messages">
        <div v-for="m in messages" :key="m.time" class="msg">
          [{{ m.time }}] {{ m.text }}
        </div>
      </div>
    </div>

    <div class="block">
      <h3>Logs</h3>
      <div class="logs">
        <div v-for="l in logs" :key="l.time">[{{ l.time }}] {{ l.msg }}</div>
      </div>
    </div>
  </div>
  `
}).mount('#app');
