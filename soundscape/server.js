const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store active sessions: { pairingCode: { desktopSocket, mobileSocket, state } }
const sessions = new Map();

// Serve static files from soundscape directory
app.use(express.static(path.join(__dirname)));

// Generate 6-digit pairing code
function generatePairingCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (sessions.has(code));
    return code;
}

io.on('connection', (socket) => {
    console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);

    // Desktop creates a new session
    socket.on('desktop:create-session', (callback) => {
        const code = generatePairingCode();
        sessions.set(code, {
            desktopSocket: socket,
            mobileSocket: null,
            state: {},
            createdAt: Date.now()
        });

        socket.pairingCode = code;
        console.log(`✅ Desktop session created with code: ${code}`);

        callback({ success: true, code });
    });

    // Mobile joins existing session
    socket.on('mobile:join-session', (code, callback) => {
        const session = sessions.get(code);

        if (!session) {
            console.log(`❌ Mobile tried to join invalid code: ${code}`);
            callback({ success: false, error: 'Invalid pairing code' });
            return;
        }

        if (session.mobileSocket) {
            console.log(`⚠️  Mobile replaced on session: ${code}`);
            session.mobileSocket.disconnect();
        }

        session.mobileSocket = socket;
        socket.pairingCode = code;

        console.log(`✅ Mobile joined session: ${code}`);

        // Notify desktop that mobile connected
        if (session.desktopSocket) {
            session.desktopSocket.emit('mobile:connected');
        }

        callback({ success: true, state: session.state });
    });

    // Desktop sends state update
    socket.on('desktop:state-update', (state) => {
        const code = socket.pairingCode;
        const session = sessions.get(code);

        if (session) {
            session.state = state;
            // Forward to mobile if connected
            if (session.mobileSocket) {
                session.mobileSocket.emit('state-update', state);
            }
        }
    });

    // Mobile sends control update
    socket.on('mobile:control-update', (update) => {
        const code = socket.pairingCode;
        const session = sessions.get(code);

        if (session) {
            // Merge update into session state
            session.state = { ...session.state, ...update };

            // Forward to desktop
            if (session.desktopSocket) {
                session.desktopSocket.emit('control-update', update);
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const code = socket.pairingCode;
        if (!code) return;

        const session = sessions.get(code);
        if (!session) return;

        if (session.desktopSocket === socket) {
            console.log(`🔌 Desktop disconnected from session: ${code}`);
            // Notify mobile
            if (session.mobileSocket) {
                session.mobileSocket.emit('desktop:disconnected');
            }
            // Clean up session
            sessions.delete(code);
        } else if (session.mobileSocket === socket) {
            console.log(`📱 Mobile disconnected from session: ${code}`);
            session.mobileSocket = null;
            // Notify desktop
            if (session.desktopSocket) {
                session.desktopSocket.emit('mobile:disconnected');
            }
        }
    });
});

// Cleanup old sessions (older than 24 hours)
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const [code, session] of sessions.entries()) {
        if (now - session.createdAt > maxAge) {
            console.log(`🧹 Cleaning up old session: ${code}`);
            sessions.delete(code);
        }
    }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Soundscape WebSocket server running on port ${PORT}`);
    console.log(`📱 Access at: http://localhost:${PORT}/`);
});
