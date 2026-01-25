const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// initialize server and websocket
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
// serve static files
app.use(express.static(path.join(__dirname, 'public')));

// game state storage
const rooms = new Map();
const clientConnections = new Map();
const roomTimers = new Map(); 

// initial game state template
function createGameState() {
    return {
        players: [],
        currentPlayer: null,
        timer: 10,
        usedWords: [],
        lastWord: '',
        gameState: 'waiting', 
        scores: {},
        lives: { player1: 3, player2: 3 },
        winner: null
    };
}

// room creation helper
function createRoom() {
    return {
        id: Math.random().toString(36).substring(2, 8).toUpperCase(),
        gameState: createGameState()
    };
}

// websocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // message handler
    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch (error) {
            console.error('Invalid JSON received:', error);
            return sendError(ws, 'Invalid message format');
        }
        
        console.log('Received message:', data);

        switch (data.type) {
            case 'create_room': handleCreateRoom(ws); break;
            case 'join_room': handleJoinRoom(ws, data.roomId); break;
            case 'submit_word': handleSubmitWord(ws, data.word); break;
            case 'start_game': handleStartGame(ws); break;
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        cleanupConnection(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        cleanupConnection(ws);
    });
});

// room management functions
function handleCreateRoom(ws) {
    const room = createRoom(); // {id: ..., gamestate: {...}}
    rooms.set(room.id, room);
    const player1Id = 'player1';
    room.gameState.players.push(player1Id);
    clientConnections.set(ws, { roomId: room.id, playerId: player1Id });
    
    ws.send(JSON.stringify({
        type: 'room_created',
        roomId: room.id,
        playerId: player1Id
    }));
}

function handleJoinRoom(ws, roomId) {
    if (!roomId || typeof roomId !== 'string') {
        return sendError(ws, 'Invalid room ID');
    }
    
    const room = rooms.get(roomId);
    if (!room) return sendError(ws, 'Room not found');
    if (room.gameState.players.length >= 2) return sendError(ws, 'Room is full');

    const player2Id = 'player2';
    room.gameState.players.push(player2Id);
    clientConnections.set(ws, { roomId: roomId, playerId: player2Id });

    broadcastToRoom(roomId, {
        type: 'player_joined',
        gameState: room.gameState
    });

    ws.send(JSON.stringify({
        type: 'player_assigned',
        playerId: player2Id
    }));
}

// game logic functions
async function handleSubmitWord(ws, word) {
    const connection = clientConnections.get(ws);
    if (!connection) return;

    const { roomId, playerId } = connection;
    const room = rooms.get(roomId);
    if (!room) return;

    // input validation
    if (!word || typeof word !== 'string') {
        return sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: 'Invalid word input'
        });
    }

    const gameState = room.gameState;
    word = word.toLowerCase().trim();
    
    // validate word format (letters only, reasonable length)
    if (!/^[a-z]+$/.test(word) || word.length < 2 || word.length > 50) {
        return sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: 'Word must be 2-50 letters only'
        });
    }

    // various game rule checks
    if (gameState.gameState === 'finished') {
        return sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: 'Game is over'
        });
    }

    if (gameState.currentPlayer !== playerId) {
        return sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: 'Not your turn'
        });
    }

    const isValidWord = word[0] === (gameState.lastWord ? gameState.lastWord.slice(-1) : word[0]) 
                       && !gameState.usedWords.includes(word);

    if (!isValidWord) {
        gameState.lives[playerId]--;
        checkGameOver(room, playerId);
        return sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: `Invalid word. ${gameState.lives[playerId]} tries remaining.`
        });
    }

    // dictionary API check
    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.ok) throw new Error('Invalid word');

        // update game state on valid word
        gameState.usedWords.push(word);
        gameState.lastWord = word;
        gameState.scores[playerId] = (gameState.scores[playerId] || 0) + word.length;
        gameState.currentPlayer = playerId === 'player1' ? 'player2' : 'player1';
        gameState.timer = 10;

        broadcastToRoom(roomId, {
            type: 'game_state_update',
            gameState: gameState
        });

    } catch (error) {
        gameState.lives[playerId]--;
        checkGameOver(room, playerId);
        
        // Provide more specific error messages
        let errorMessage = `Invalid word. ${gameState.lives[playerId]} tries remaining.`;
        
        if (error.message.includes('fetch')) {
            errorMessage = `Dictionary API error (network/rate limit). ${gameState.lives[playerId]} tries remaining.`;
        } else if (error.message.includes('Invalid word')) {
            errorMessage = `Word not found in dictionary. ${gameState.lives[playerId]} tries remaining.`;
        }
        
        sendToPlayer(roomId, playerId, {
            type: 'word_rejected',
            message: errorMessage,
            errorType: error.message.includes('fetch') ? 'api_error' : 'invalid_word'
        });
    }
}

// game control functions
function handleStartGame(ws) {
    const connection = clientConnections.get(ws);
    if (!connection) return;

    const { roomId, playerId } = connection;
    const room = rooms.get(roomId);
    
    if (!room || playerId !== 'player1') return;
    
    // require both players to start
    if (room.gameState.players.length < 2) {
        return sendToPlayer(roomId, playerId, {
            type: 'error',
            message: 'Need 2 players to start'
        });
    }
    
    // stop any existing timer
    stopGameTimer(roomId);
    
    // reset game state for new game
    room.gameState = {
        ...room.gameState,
        gameState: 'playing',
        currentPlayer: 'player1',
        timer: 10,
        usedWords: [],
        lastWord: '',
        scores: { player1: 0, player2: 0 },
        lives: { player1: 3, player2: 3 },
        winner: null
    };
    
    broadcastToRoom(roomId, {
        type: 'game_started',
        gameState: room.gameState
    });

    startGameTimer(roomId);
}

// timer management
function startGameTimer(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.gameState.gameState !== 'playing') return;

    // stop any existing timer first
    stopGameTimer(roomId);

    room.gameState.timer = 10;

    const timerInterval = setInterval(() => {
        const currentRoom = rooms.get(roomId);
        if (!currentRoom || currentRoom.gameState.gameState !== 'playing') {
            clearInterval(timerInterval);
            roomTimers.delete(roomId);
            return;
        }

        currentRoom.gameState.timer--;

        if (currentRoom.gameState.timer <= 0) {
            currentRoom.gameState.lives[currentRoom.gameState.currentPlayer]--;
            checkGameOver(currentRoom, currentRoom.gameState.currentPlayer);
            
            if (currentRoom.gameState.gameState !== 'finished') {
                currentRoom.gameState.currentPlayer = currentRoom.gameState.currentPlayer === 'player1' ? 'player2' : 'player1';
                currentRoom.gameState.timer = 10;
            }
        }

        broadcastToRoom(roomId, {
            type: 'game_state_update',
            gameState: currentRoom.gameState
        });
    }, 1000);
    
    roomTimers.set(roomId, timerInterval);
}

function stopGameTimer(roomId) {
    const timer = roomTimers.get(roomId);
    if (timer) {
        clearInterval(timer);
        roomTimers.delete(roomId);
    }
}

// utility functions
function broadcastToRoom(roomId, message) {
    for (const [ws, data] of clientConnections.entries()) {
        if (data.roomId === roomId) {
            ws.send(JSON.stringify(message));
        }
    }
}

function sendToPlayer(roomId, playerId, message) {
    for (const [ws, data] of clientConnections.entries()) {
        if (data.roomId === roomId && data.playerId === playerId) {
            ws.send(JSON.stringify(message));
            break;
        }
    }
}

function sendError(ws, message) {
    ws.send(JSON.stringify({
        type: 'error',
        message: message
    }));
}


function checkGameOver(room, lastPlayer) {
    const gameState = room.gameState;
    if (gameState.lives[lastPlayer] <= 0) {
        gameState.gameState = 'finished';
        gameState.winner = lastPlayer === 'player1' ? 'player2' : 'player1';
        
        // stop timer when game ends
        stopGameTimer(room.id);
        
        broadcastToRoom(room.id, {
            type: 'game_over',
            gameState: gameState
        });
    }
}

// cleanup functions
function cleanupConnection(ws) {
    const connection = clientConnections.get(ws);
    if (!connection) return;

    const { roomId, playerId } = connection;
    clientConnections.delete(ws);

    const room = rooms.get(roomId);
    if (!room) return;

    // remove player from room
    const playerIndex = room.gameState.players.indexOf(playerId);
    if (playerIndex > -1) {
        room.gameState.players.splice(playerIndex, 1);
    }

    // check if room is empty and clean it up
    const playersInRoom = Array.from(clientConnections.values())
        .filter(conn => conn.roomId === roomId).length;
    
    if (playersInRoom === 0) {
        stopGameTimer(roomId);
        rooms.delete(roomId);
        console.log(`Room ${roomId} cleaned up`);
    } else {
        // notify remaining players
        broadcastToRoom(roomId, {
            type: 'player_left',
            gameState: room.gameState
        });
    }
}

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});