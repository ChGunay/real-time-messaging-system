const { createApp } = Vue;

createApp({
    data() {
        return {
            username: '',
            email: '',
            password: '',
            token: '',
            authError: '',
            socket: null,
            socketStatus: 'Disconnected',
            conversationId: '',
            messageContent: '',
            messages: [],
            logs: []
        };
    },
    computed: {
        isConnected() {
            return this.socket && this.socket.connected;
        }
    },
    methods: {
        log(message, type = 'info') {
            this.logs.push({ message, type, time: new Date().toLocaleTimeString() });
        },
        async register() {
            try {
                const res = await fetch('http://localhost:3000/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: this.username, email: this.email, password: this.password })
                });
                const data = await res.json();
                if (data.success) {
                    this.token = data.data.tokens.accessToken;
                    this.log('Registered successfully', 'success');
                } else {
                    this.authError = data.message;
                    this.log('Register failed: ' + data.message, 'error');
                }
            } catch (err) {
                this.authError = err.message;
                this.log('Register error: ' + err.message, 'error');
            }
        },
        async login() {
            try {
                const res = await fetch('http://localhost:3000/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: this.email, password: this.password })
                });
                const data = await res.json();
                if (data.success) {
                    this.token = data.data.tokens.accessToken;
                    this.log('Logged in successfully', 'success');
                } else {
                    this.authError = data.message;
                    this.log('Login failed: ' + data.message, 'error');
                }
            } catch (err) {
                this.authError = err.message;
                this.log('Login error: ' + err.message, 'error');
            }
        },
        connectSocket() {
            if (!this.token) return;
            this.socket = io('http://localhost:3000', { auth: { token: this.token } });
            this.socket.on('connect', () => {
                this.socketStatus = 'Connected';
                this.log('Socket connected', 'success');
            });
            this.socket.on('disconnect', () => {
                this.socketStatus = 'Disconnected';
                this.log('Socket disconnected', 'info');
            });
            this.socket.on('receive_message', (msg) => {
                this.messages.push(msg);
            });
        },
        disconnectSocket() {
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
                this.socketStatus = 'Disconnected';
            }
        },
        disconnect() {
            this.disconnectSocket();
            this.token = '';
            this.username = '';
            this.email = '';
            this.password = '';
            this.log('Logged out', 'info');
        },
        joinRoom() {
            if (this.socket && this.conversationId) {
                this.socket.emit('join_room', { conversationId: this.conversationId });
                this.log('Joined room ' + this.conversationId, 'info');
            }
        },
        async createConversation() {
            try {
                const res = await fetch('http://localhost:3000/api/conversations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({ participantId: this.username })
                });
                const data = await res.json();
                if (data.success) {
                    this.conversationId = data.data.conversation._id;
                    this.log('Conversation created', 'success');
                } else {
                    this.log('Create conversation failed: ' + data.message, 'error');
                }
            } catch (err) {
                this.log('Create conversation error: ' + err.message, 'error');
            }
        },
        sendMessage() {
            if (this.socket && this.messageContent && this.conversationId) {
                this.socket.emit('send_message', {
                    conversationId: this.conversationId,
                    content: this.messageContent
                });
                this.messageContent = '';
                this.log('Message sent', 'info');
            }
        }
    }
}).mount('#app');
