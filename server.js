import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

// Store active game rooms
const rooms = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ status: 'Liquid Wars multiplayer server running' });
});

app.get('/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    host: room.host.name,
    playerCount: room.players.length,
    gameRunning: room.gameRunning,
    settings: room.settings
  }));
  res.json(roomList);
});

app.head('/health', (req, res) => {
  res.status(200).send();
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Socket.IO events
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Create a new game room (host)
  socket.on('create-room', (playerName, callback) => {
    const roomId = Math.random().toString(36).substring(7);
    const room = {
      id: roomId,
      host: {
        id: socket.id,
        name: playerName,
        team: 0
      },
      players: [
        {
          id: socket.id,
          name: playerName,
          team: 0,
          ready: false
        }
      ],
      settings: {
        teamSize: 400,
        selectedMapId: -1,
        customMapCollisionUrl: null,
        customMapDisplayUrl: null,
        timerSeconds: 0
      },
      gameRunning: false,
      gameState: null,
      snapshotAcks: new Map(),
      createdAt: Date.now()
    };

    room.snapshotAcks.set(socket.id, 0);

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerName = playerName;
    socket.data.isHost = true;

    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId, room });
  });

  // Join an existing room (client)
  socket.on('join-room', (roomId, playerName, callback) => {
    const room = rooms.get(roomId);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (room.gameRunning) {
      callback({ success: false, error: 'Game already running' });
      return;
    }

    // Find next available team
    const usedTeams = room.players.map(p => p.team);
    const availableTeam = [0, 1, 2, 3, 4, 5].find(t => !usedTeams.includes(t));

    if (availableTeam === undefined) {
      callback({ success: false, error: 'No teams available' });
      return;
    }

    const player = {
      id: socket.id,
      name: playerName,
      team: availableTeam,
      ready: false
    };

    room.players.push(player);
    room.snapshotAcks.set(socket.id, 0);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerName = playerName;
    socket.data.isHost = false;

    console.log(`${playerName} joined room ${roomId}`);

    // Notify all clients in the room
    io.to(roomId).emit('player-joined', {
      players: room.players,
      newPlayer: player
    });

    callback({ success: true, roomId, room, yourTeam: availableTeam });
  });

  // Update game settings (host only)
  socket.on('update-settings', (newSettings, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host.id !== socket.id) {
      callback({ success: false, error: 'Only host can update settings' });
      return;
    }

    room.settings = { ...room.settings, ...newSettings };
    io.to(roomId).emit('settings-updated', room.settings);

    callback({ success: true, settings: room.settings });
  });

  // Sync custom map to all clients
  socket.on('sync-custom-map', (mapData, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host.id !== socket.id) {
      callback({ success: false, error: 'Only host can sync custom map' });
      return;
    }

    room.settings.customMapCollisionUrl = mapData.collisionUrl;
    room.settings.customMapDisplayUrl = mapData.displayUrl;

    io.to(roomId).emit('custom-map-synced', {
      collisionUrl: mapData.collisionUrl,
      displayUrl: mapData.displayUrl
    });

    callback({ success: true });
  });

  // Player ready status
  socket.on('player-ready', (ready, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room) {
      callback({ success: false });
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = ready;
      io.to(roomId).emit('players-updated', room.players);
    }

    callback({ success: true });
  });

  // Start game (host only)
  socket.on('start-game', (gameSettings, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host.id !== socket.id) {
      callback({ success: false, error: 'Only host can start game' });
      return;
    }

    const allReady = room.players.length > 0 && room.players.every(p => p.ready);
    if (!allReady) {
      callback({ success: false, error: 'Not all players are ready' });
      return;
    }

    room.gameRunning = true;
    room.gameState = {
      startedAt: Date.now(),
      ...gameSettings
    };

    io.to(roomId).emit('game-started', room.gameState);
    callback({ success: true });
  });

  // Kick a player from the room (host only)
  socket.on('kick-player', (playerId, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.host.id !== socket.id) {
      callback?.({ success: false, error: 'Only host can kick players' });
      return;
    }

    const idx = room.players.findIndex(p => p.id === playerId);
    if (idx === -1) {
      callback?.({ success: false, error: 'Player not found' });
      return;
    }

    const [removed] = room.players.splice(idx, 1);
    room.snapshotAcks?.delete(playerId);

    // Notify the kicked player (if connected)
    const targetSocket = io.sockets.sockets.get(playerId);
    if (targetSocket) {
      try {
        targetSocket.leave(roomId);
        targetSocket.data.roomId = null;
        targetSocket.emit('kicked', { reason: 'Kicked by host' });
      } catch (e) {
        console.warn('Failed to notify kicked player:', e?.message || e);
      }
    }

    io.to(roomId).emit('player-left', removed.name);
    io.to(roomId).emit('players-updated', room.players);
    callback?.({ success: true });
  });

  // Game state updates - host only, relayed to other clients
  socket.on('game-state-update', (stateUpdate) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!roomId || !room?.gameRunning || room.host.id !== socket.id) return;

    socket.to(roomId).emit('game-state-update', {
      from: socket.id,
      data: stateUpdate
    });
  });

  // Client requests host to send a full snapshot
  socket.on('request-full-state', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!roomId || !room?.gameRunning || room.host.id === socket.id) return;

    const hostSocket = io.sockets.sockets.get(room.host.id);
    hostSocket?.emit('request-full-state', { requesterId: socket.id });
  });

  // Non-host clients acknowledge snapshot frames they applied
  socket.on('snapshot-ack', (payload) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.host.id === socket.id) return;

    const frame = Number.isFinite(payload?.frame) ? Math.max(0, payload.frame | 0) : 0;
    room.snapshotAcks.set(socket.id, frame);

    const hostSocket = io.sockets.sockets.get(room.host.id);
    hostSocket?.emit('snapshot-ack', { playerId: socket.id, frame });
  });

  // Commander position updates from human players
  socket.on('player-position', (position) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!roomId || !room?.gameRunning) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    const payload = {
      playerId: socket.id,
      position: {
        ...position,
        team: typeof position?.team === 'number' ? position.team : player.team
      }
    };

    if (room.host.id === socket.id) {
      socket.to(roomId).emit('player-position', payload);
    } else {
      io.to(roomId).emit('player-position', payload);
    }
  });

  // End game (host)
  socket.on('end-game', (gameResult, callback) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room || room.host.id !== socket.id) {
      callback({ success: false });
      return;
    }

    room.gameRunning = false;
    io.to(roomId).emit('game-ended', gameResult);
    callback({ success: true });
  });

  // Return to menu
  socket.on('return-to-menu', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (!room) return;

    room.gameRunning = false;
    room.players.forEach(p => p.ready = false);

    io.to(roomId).emit('players-updated', room.players);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);

    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      room.snapshotAcks?.delete(socket.id);

      if (room.host.id === socket.id) {
        // Host left - delete room
        rooms.delete(roomId);
        io.to(roomId).emit('room-closed', 'Host disconnected');
        console.log(`Room ${roomId} closed (host left)`);
      } else {
        io.to(roomId).emit('player-left', socket.data.playerName);
        io.to(roomId).emit('players-updated', room.players);
        console.log(`${socket.data.playerName} left room ${roomId}`);
      }
    }

    console.log(`Disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Liquid Wars multiplayer server listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});