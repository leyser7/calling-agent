import { AudioPlayer } from './lib/play/AudioPlayer.js';

const socket = io();

function getPromptIdFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('prompt') || 'default';
}

const translations = {
    es: {
        notConnected: "No conectado",
        assistant: "Asistente",
        disconnected: "Desconectado",
        connected: "Conectado",
        connecting: "Conectando...",
        start: "Iniciar",
        end: "Finalizar",
        requestingMic: "Solicitando acceso al micrófono...",
        ready: "Listo. Presiona Iniciar",
        startingSession: "Iniciando sesión...",
        sessionStarted: "Sesión iniciada",
        sessionError: "Error al iniciar sesión",
        inCall: "En llamada... Hablando",
        processing: "Procesando...",
        finished: "Finalizado. Presiona Iniciar",
        connectedToServer: "Conectado al servidor",
        disconnectedFromServer: "Desconectado del servidor"
    },
    en: {
        notConnected: "Not connected",
        assistant: "Assistant",
        disconnected: "Disconnected",
        connected: "Connected",
        connecting: "Connecting...",
        start: "Start",
        end: "End",
        requestingMic: "Requesting microphone access...",
        ready: "Ready. Press Start",
        startingSession: "Starting session...",
        sessionStarted: "Session started",
        sessionError: "Error starting session",
        inCall: "In call... Speaking",
        processing: "Processing...",
        finished: "Finished. Press Start",
        connectedToServer: "Connected to server",
        disconnectedFromServer: "Disconnected from server"
    }
};

let currentLanguage = 'en';

function t(key) {
    return translations[currentLanguage]?.[key] || key;
}

function setLanguage(lang) {
    currentLanguage = lang;
    document.documentElement.lang = lang;
    
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (translations[lang] && translations[lang][key]) {
            element.textContent = translations[lang][key];
        }
    });
}

const promptId = getPromptIdFromURL();

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusElement = document.getElementById('status');
const statusTextElement = document.getElementById('status-text');
const callDurationElement = document.getElementById('call-duration');

let callStartTime = null;
let callTimerInterval = null;

let audioContext;
let audioStream;
let isStreaming = false;
let processor;
let sourceNode;
let transcriptionReceived = false;
let displayAssistantText = false;
let role;
const audioPlayer = new AudioPlayer();
let sessionInitialized = false;
let manualDisconnect = false;

let samplingRatio = 1;
const TARGET_SAMPLE_RATE = 16000; 
const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');

function updateStatus(text, className) {
    statusElement.textContent = text;
    statusElement.className = `call-status ${className}`;
    if (statusTextElement) {
        statusTextElement.textContent = text;
    }
}

function updateCallDuration() {
    if (!callStartTime || !callDurationElement) return;
    
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    callDurationElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function startCallTimer() {
    callStartTime = Date.now();
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(updateCallDuration, 1000);
    updateCallDuration();
}

function stopCallTimer() {
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    if (callDurationElement) {
        callDurationElement.textContent = '--:--';
    }
}

async function initAudio() {
    try {
        updateStatus(t('requestingMic'), "connecting");

        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        if (isFirefox) {
            audioContext = new AudioContext();
        } else {
            audioContext = new AudioContext({
                sampleRate: TARGET_SAMPLE_RATE
            });
        }

        samplingRatio = audioContext.sampleRate / TARGET_SAMPLE_RATE;
        
        await audioPlayer.start();

        updateStatus(t('ready'), "ready");
        startButton.disabled = false;
    } catch (error) {
        console.error("Error accessing microphone:", error);
        updateStatus("Error: " + error.message, "error");
    }
}

async function initializeSession() {
    if (sessionInitialized) return;

    updateStatus(t('startingSession'), "connecting");

    try {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
            
            socket.emit('initializeConnection', (ack) => {
                clearTimeout(timeout);
                if (ack?.success) resolve();
                else reject(new Error(ack?.error || 'Connection failed'));
            });
        });

        socket.emit('promptStart', { promptId: promptId });
        socket.emit('systemPrompt', { promptId: promptId });
        socket.emit('audioStart', { promptId: promptId });

        sessionInitialized = true;
        updateStatus(t('sessionStarted'), "connected");
    } catch (error) {
        console.error("Failed to initialize session:", error);
        updateStatus(t('sessionError'), "error");
        throw error;
    }
}

async function startStreaming() {
    if (isStreaming) return;

    try {
        if (!socket.connected) {
            socket.connect();
            await new Promise((resolve) => {
                if (socket.connected) {
                    resolve();
                } else {
                    socket.once('connect', resolve);
                }
            });
        }

        if (!audioPlayer.initialized) {
            await audioPlayer.start();
        }

        if (!sessionInitialized) {
            await initializeSession();
        }

        sourceNode = audioContext.createMediaStreamSource(audioStream);

        if (audioContext.createScriptProcessor) {
            processor = audioContext.createScriptProcessor(512, 1, 1);

            processor.onaudioprocess = (e) => {
                if (!isStreaming) return;

                const inputData = e.inputBuffer.getChannelData(0);
                const numSamples = Math.round(inputData.length / samplingRatio)
                const pcmData = isFirefox ? (new Int16Array(numSamples)) : (new Int16Array(inputData.length));
                
                if (isFirefox) {                    
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i * samplingRatio])) * 0x7FFF;
                    }
                } else {
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                    }
                }
                
                const base64Data = arrayBufferToBase64(pcmData.buffer);

                socket.emit('audioInput', base64Data);
            };

            sourceNode.connect(processor);
            processor.connect(audioContext.destination);
        }

        isStreaming = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        updateStatus(t('inCall'), "connected");
        
        startCallTimer();

        transcriptionReceived = false;

    } catch (error) {
        console.error("Error starting recording:", error);
        updateStatus("Error: " + error.message, "error");
    }
}

function arrayBufferToBase64(buffer) {
    const binary = [];
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary.push(String.fromCharCode(bytes[i]));
    }
    return btoa(binary.join(''));
}

function stopStreaming() {
    if (!isStreaming) return;

    isStreaming = false;

    if (processor) {
        processor.disconnect();
        sourceNode.disconnect();
    }

    startButton.disabled = false;
    stopButton.disabled = true;
    updateStatus(t('processing'), "processing");
    
    stopCallTimer();

    audioPlayer.bargeIn();
    socket.emit('stopAudio');

    sessionInitialized = false;
    
    manualDisconnect = true;
    
    socket.disconnect();
    
    updateStatus(t('finished'), "ready");
}

function base64ToFloat32Array(base64String) {
    try {
        const binaryString = window.atob(base64String);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }

        return float32Array;
    } catch (error) {
        console.error('Error in base64ToFloat32Array:', error);
        throw error;
    }
}

socket.on('promptMetadata', (metadata) => {
    if (metadata.language) {
        setLanguage(metadata.language);
    }
    
    const callerNameElement = document.querySelector('.caller-name');
    if (callerNameElement && metadata.name) {
        callerNameElement.textContent = metadata.name;
    }
});

socket.on('contentStart', (data) => {
    if (data.type === 'TEXT') {
        role = data.role;
        if (data.role === 'ASSISTANT') {
            let isSpeculative = false;
            try {
                if (data.additionalModelFields) {
                    const additionalFields = JSON.parse(data.additionalModelFields);
                    isSpeculative = additionalFields.generationStage === "SPECULATIVE";
                    if (isSpeculative) {
                        displayAssistantText = true;
                    }
                    else {
                        displayAssistantText = false;
                    }
                }
            } catch (e) {
            }
        }
    }
});

socket.on('textOutput', (data) => {
    if (role === 'USER') {
        transcriptionReceived = true;
    }
});

socket.on('audioOutput', (data) => {
    if (data.content) {
        try {
            const audioData = base64ToFloat32Array(data.content);
            audioPlayer.playAudio(audioData);
        } catch (error) {
            console.error('Error processing audio data:', error);
        }
    }
});

socket.on('contentEnd', (data) => {
    if (data.type === 'TEXT') {
        if (data.stopReason && data.stopReason.toUpperCase() === 'END_TURN') {
            // End turn handling
        } else if (data.stopReason && data.stopReason.toUpperCase() === 'INTERRUPTED') {
            audioPlayer.bargeIn();
        }
    }
});

socket.on('streamComplete', () => {
    if (isStreaming) {
        stopStreaming();
    }
    updateStatus(t('ready'), "ready");
});

socket.on('connect', () => {
    updateStatus(t('connectedToServer'), "connected");
    sessionInitialized = false;
    
    socket.emit('getPromptMetadata', { promptId: promptId });
});

socket.on('disconnect', () => {
    if (manualDisconnect) {
        manualDisconnect = false;
        updateStatus(t('finished'), "ready");
        startButton.disabled = false;
        stopButton.disabled = true;
    } else {
        updateStatus(t('disconnectedFromServer'), "disconnected");
        startButton.disabled = true;
        stopButton.disabled = true;
    }
    sessionInitialized = false;
});

socket.on('error', (error) => {
    updateStatus("Error: " + (error.message || JSON.stringify(error).substring(0, 100)), "error");
});

startButton.addEventListener('click', startStreaming);
stopButton.addEventListener('click', stopStreaming);

document.addEventListener('DOMContentLoaded', initAudio);
