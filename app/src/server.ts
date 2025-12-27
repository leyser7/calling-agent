import express from 'express';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { fromIni } from "@aws-sdk/credential-providers";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { NovaSonicBidirectionalStreamClient, StreamSession } from './client';
import { Buffer } from 'node:buffer';
import { AgentLoader } from './AgentLoader';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const bedrockClient = new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
        maxConcurrentStreams: 10,
    },
    clientConfig: {
        region: process.env.AWS_REGION || "us-east-1",
        credentials: process.env.AWS_PROFILE ? fromIni({ profile: process.env.AWS_PROFILE }) : defaultProvider()
    }
});

const agentLoader = new AgentLoader();

const socketSessions = new Map<string, StreamSession>();

enum SessionState {
    INITIALIZING = 'initializing',
    READY = 'ready',
    ACTIVE = 'active',
    CLOSED = 'closed'
}

const sessionStates = new Map<string, SessionState>();
const cleanupInProgress = new Map<string, boolean>();

setInterval(() => {
    console.log("Session cleanup check");
    const now = Date.now();

    bedrockClient.getActiveSessions().forEach(sessionId => {
        const lastActivity = bedrockClient.getLastActivityTime(sessionId);

        if (now - lastActivity > 5 * 60 * 1000) {
            console.log(`Closing inactive session ${sessionId} after 5 minutes of inactivity`);
            try {
                bedrockClient.forceCloseSession(sessionId);
            } catch (error) {
                console.error(`Error force closing inactive session ${sessionId}:`, error);
            }
        }
    });
}, 60000);

app.use(express.static(path.join(__dirname, '../public')));

async function createNewSession(socket: any): Promise<StreamSession> {
    const sessionId = socket.id;

    try {
        console.log(`Creating new session for client: ${sessionId}`);
        sessionStates.set(sessionId, SessionState.INITIALIZING);

        const session = bedrockClient.createStreamSession(sessionId);

        setupSessionEventHandlers(session, socket);

        socketSessions.set(sessionId, session);
        sessionStates.set(sessionId, SessionState.READY);

        console.log(`Session ${sessionId} created and ready, stored in maps`);
        console.log(`Session map size: ${socketSessions.size}, States map size: ${sessionStates.size}`);
        console.log(`Stored session for ${sessionId}:`, !!socketSessions.get(sessionId));

        return session;
    } catch (error) {
        console.error(`Error creating session for ${sessionId}:`, error);
        sessionStates.set(sessionId, SessionState.CLOSED);
        throw error;
    }
}

function setupSessionEventHandlers(session: StreamSession, socket: any) {


    session.onEvent('usageEvent', (data) => {
        console.log('usageEvent:', data);
        socket.emit('usageEvent', data);
    });

    session.onEvent('completionStart', (data) => {
        console.log('completionStart:', data);
        socket.emit('completionStart', data);
    });

    session.onEvent('contentStart', (data) => {
        console.log('contentStart:', data);
        socket.emit('contentStart', data);
    });

    session.onEvent('textOutput', (data) => {
        console.log('Text output:', data);
        socket.emit('textOutput', data);
    });

    session.onEvent('audioOutput', (data) => {
        console.log('Audio output received, sending to client');
        socket.emit('audioOutput', data);
    });

    session.onEvent('error', (data) => {
        console.error('Error in session:', data);
        socket.emit('error', data);
    });

    session.onEvent('contentEnd', (data) => {
        console.log('Content end received: ', data);
        socket.emit('contentEnd', data);
    });

    session.onEvent('streamComplete', () => {
        console.log('Stream completed for client:', socket.id);
        socket.emit('streamComplete');
        sessionStates.set(socket.id, SessionState.CLOSED);
    });
}

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    sessionStates.set(socket.id, SessionState.CLOSED);

    const connectionInterval = setInterval(() => {
        const connectionCount = Object.keys(io.sockets.sockets).length;
        console.log(`Active socket connections: ${connectionCount}`);
    }, 60000);

    socket.on('initializeConnection', async (callback) => {
        try {
            const currentState = sessionStates.get(socket.id);
            console.log(`Initializing session for ${socket.id}, current state: ${currentState}`);
            if (currentState === SessionState.INITIALIZING || currentState === SessionState.READY || currentState === SessionState.ACTIVE) {
                console.log(`Session already exists for ${socket.id}, state: ${currentState}`);
                if (callback) callback({ success: true });
                return;
            }

            await createNewSession(socket);

            console.log(`Starting AWS Bedrock connection for ${socket.id}`);
            bedrockClient.initiateBidirectionalStreaming(socket.id);

            sessionStates.set(socket.id, SessionState.ACTIVE);

            if (callback) callback({ success: true });

        } catch (error) {
            console.error('Error initializing session:', error);
            sessionStates.set(socket.id, SessionState.CLOSED);
            if (callback) callback({ success: false, error: error instanceof Error ? error.message : String(error) });
            socket.emit('error', {
                message: 'Failed to initialize session',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('getPromptMetadata', async (data) => {
        try {
            const promptId = data?.promptId || 'default';
            const agentInfo = agentLoader.getAgentInfo(promptId);

            if (agentInfo) {
                socket.emit('promptMetadata', {
                    name: agentInfo.name,
                    language: agentInfo.language
                });
            } else {
                socket.emit('promptMetadata', {
                    name: 'Assistant',
                    language: 'en'
                });
            }
        } catch (error) {
            console.error('Error getting prompt metadata:', error);
            socket.emit('promptMetadata', {
                name: 'Assistant',
                language: 'en'
            });
        }
    });

    socket.on('startNewChat', async () => {
        try {
            const currentState = sessionStates.get(socket.id);
            console.log(`Starting new chat for ${socket.id}, current state: ${currentState}`);

            const existingSession = socketSessions.get(socket.id);
            if (existingSession && bedrockClient.isSessionActive(socket.id)) {
                console.log(`Cleaning up existing session for ${socket.id}`);
                try {
                    await existingSession.endAudioContent();
                    await existingSession.endPrompt();
                    await existingSession.close();
                } catch (cleanupError) {
                    console.error(`Error during cleanup for ${socket.id}:`, cleanupError);
                    bedrockClient.forceCloseSession(socket.id);
                }
                socketSessions.delete(socket.id);
            }

            await createNewSession(socket);
        } catch (error) {
            console.error('Error starting new chat:', error);
            socket.emit('error', {
                message: 'Failed to start new chat',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('audioInput', async (audioData) => {
        try {
            const session = socketSessions.get(socket.id);
            const currentState = sessionStates.get(socket.id);


            if (!session || currentState !== SessionState.ACTIVE) {
                console.error(`Invalid session state for audio input: session=${!!session}, state=${currentState}`);
                socket.emit('error', {
                    message: 'No active session for audio input',
                    details: `Session exists: ${!!session}, Session state: ${currentState}. Session must be ACTIVE to receive audio.`
                });
                return;
            }

            const audioBuffer = typeof audioData === 'string'
                ? Buffer.from(audioData, 'base64')
                : Buffer.from(audioData);

            await session.streamAudio(audioBuffer);

        } catch (error) {
            console.error('Error processing audio:', error);
            socket.emit('error', {
                message: 'Error processing audio',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('promptStart', async (data) => {
        try {
            const session = socketSessions.get(socket.id);
            const currentState = sessionStates.get(socket.id);
            console.log(`Prompt start received for ${socket.id}, session exists: ${!!session}, state: ${currentState}`);

            if (!session) {
                console.error(`No session found for promptStart: ${socket.id}`);
                socket.emit('error', { message: 'No active session for prompt start' });
                return;
            }

            const promptId = data?.promptId || 'default';
            const agent = agentLoader.getAgent(promptId);
            const voiceId = agent?.voiceId || 'carlos';

            await session.setupSessionAndPromptStart(voiceId);
            console.log(`Prompt start completed for ${socket.id} with voiceId: ${voiceId}`);
        } catch (error) {
            console.error('Error processing prompt start:', error);
            socket.emit('error', {
                message: 'Error processing prompt start',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('systemPrompt', async (data) => {
        try {
            const session = socketSessions.get(socket.id);
            const currentState = sessionStates.get(socket.id);
            console.log(`System prompt received for ${socket.id}, session exists: ${!!session}, state: ${currentState}`);

            if (!session) {
                console.error(`No session found for systemPrompt: ${socket.id}`);
                socket.emit('error', { message: 'No active session for system prompt' });
                return;
            }

            const promptId = data?.promptId || 'default';
            const agent = agentLoader.getAgent(promptId);

            const systemPromptContent = agent?.systemPrompt || 'You are a helpful assistant.';

            await session.setupSystemPrompt(undefined, systemPromptContent);
            console.log(`System prompt completed for ${socket.id}`);
        } catch (error) {
            console.error('Error processing system prompt:', error);
            socket.emit('error', {
                message: 'Error processing system prompt',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('audioStart', async (data) => {
        try {
            const session = socketSessions.get(socket.id);
            const currentState = sessionStates.get(socket.id);
            console.log(`Audio start received for ${socket.id}, session exists: ${!!session}, state: ${currentState}`);

            if (!session) {
                console.error(`No session found for audioStart: ${socket.id}`);
                socket.emit('error', { message: 'No active session for audio start' });
                return;
            }

            const promptId = data?.promptId || 'default';
            const agent = agentLoader.getAgent(promptId);
            const voiceId = agent?.voiceId || 'carlos';

            await session.setupStartAudio(voiceId);
            console.log(`Audio start setup completed for ${socket.id} with voiceId: ${voiceId}`);

            socket.emit('audioReady');
        } catch (error) {
            console.error('Error processing audio start:', error);
            sessionStates.set(socket.id, SessionState.CLOSED);
            socket.emit('error', {
                message: 'Error processing audio start',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('stopAudio', async () => {
        try {
            const session = socketSessions.get(socket.id);
            if (!session || cleanupInProgress.get(socket.id)) {
                console.log('No active session to stop or cleanup already in progress');
                return;
            }

            console.log('Stop audio requested, beginning proper shutdown sequence');
            cleanupInProgress.set(socket.id, true);
            sessionStates.set(socket.id, SessionState.CLOSED);

            const cleanupPromise = Promise.race([
                (async () => {
                    await session.endAudioContent();
                    await session.endPrompt();
                    await session.close();
                    console.log('Session cleanup complete');
                })(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Session cleanup timeout')), 5000)
                )
            ]);

            await cleanupPromise;

            socketSessions.delete(socket.id);
            cleanupInProgress.delete(socket.id);

            socket.emit('sessionClosed');

        } catch (error) {
            console.error('Error processing streaming end events:', error);

            try {
                bedrockClient.forceCloseSession(socket.id);
                socketSessions.delete(socket.id);
                cleanupInProgress.delete(socket.id);
                sessionStates.set(socket.id, SessionState.CLOSED);
            } catch (forceError) {
                console.error('Error during force cleanup:', forceError);
            }

            socket.emit('error', {
                message: 'Error processing streaming end events',
                details: error instanceof Error ? error.message : String(error)
            });
        }
    });

    socket.on('disconnect', async () => {
        console.log('Client disconnected abruptly:', socket.id);

        clearInterval(connectionInterval);

        const session = socketSessions.get(socket.id);
        const sessionId = socket.id;

        if (session && bedrockClient.isSessionActive(sessionId) && !cleanupInProgress.get(socket.id)) {
            try {
                console.log(`Beginning cleanup for abruptly disconnected session: ${socket.id}`);
                cleanupInProgress.set(socket.id, true);

                const cleanupPromise = Promise.race([
                    (async () => {
                        await session.endAudioContent();
                        await session.endPrompt();
                        await session.close();
                    })(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Session cleanup timeout')), 3000)
                    )
                ]);

                await cleanupPromise;
                console.log(`Successfully cleaned up session after abrupt disconnect: ${socket.id}`);
            } catch (error) {
                console.error(`Error cleaning up session after disconnect: ${socket.id}`, error);
                try {
                    bedrockClient.forceCloseSession(sessionId);
                    console.log(`Force closed session: ${sessionId}`);
                } catch (e) {
                    console.error(`Failed even force close for session: ${sessionId}`, e);
                }
            }
        }

        socketSessions.delete(socket.id);
        sessionStates.delete(socket.id);
        cleanupInProgress.delete(socket.id);

        console.log(`Cleanup complete for disconnected client: ${socket.id}`);
    });
});

app.get('/health', (_req, res) => {
    const activeSessions = bedrockClient.getActiveSessions().length;
    const socketConnections = Object.keys(io.sockets.sockets).length;

    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeSessions,
        socketConnections
    });
});

const PORT = process.env.PORT || 3000;

agentLoader.initialize().then(() => {
    console.log('Agent loader initialized');

    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Open http://localhost:${PORT} in your browser to access the application`);
    });
}).catch((error) => {
    console.error('Failed to initialize agent loader:', error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('Shutting down server...');

    const forceExitTimer = setTimeout(() => {
        console.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 5000);

    try {
        await new Promise(resolve => io.close(resolve));
        console.log('Socket.IO server closed');

        const activeSessions = bedrockClient.getActiveSessions();
        console.log(`Closing ${activeSessions.length} active sessions...`);

        await Promise.all(activeSessions.map(async (sessionId) => {
            try {
                await bedrockClient.closeSession(sessionId);
                console.log(`Closed session ${sessionId} during shutdown`);
            } catch (error) {
                console.error(`Error closing session ${sessionId} during shutdown:`, error);
                bedrockClient.forceCloseSession(sessionId);
            }
        }));

        await new Promise(resolve => server.close(resolve));
        clearTimeout(forceExitTimer);
        console.log('Server shut down');
        process.exit(0);
    } catch (error) {
        console.error('Error during server shutdown:', error);
        process.exit(1);
    }
});