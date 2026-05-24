# Liquid War Multiplayer Server

WebSocket server for [Liquid War](https://github.com/liquid-war/client) multiplayer matches. Handles room management, player synchronization, and real-time game state updates.

## Features

- Room creation and management
- Player join/leave handling
- Real-time game state synchronization via Socket.IO
- Room listing and discovery
- Health check endpoints
- CORS support for browser clients

## Requirements

- Node.js 18+
- npm or yarn

## Installation

```bash
npm install
```

## Running the Server

### Production

```bash
npm start
```

The server runs on port `3000` by default. Use the `PORT` environment variable to change it:

```bash
PORT=8080 npm start
```

### Development

For development with auto-reload on file changes:

```bash
npm run dev
```

## API Endpoints

### Status

- **GET** `/` - Server status
- **GET** `/health` - Health check (returns 200 OK)
- **HEAD** `/health` - Health check (returns 200 OK)

### Rooms

- **GET** `/rooms` - List all active rooms

Returns a list of rooms with the following structure:

```json
{
  "id": "abc123",
  "host": "Player Name",
  "playerCount": 2,
  "gameRunning": false,
  "settings": {
    "teamSize": 400,
    "selectedMapId": -1,
    "customMapCollisionUrl": null,
    "customMapDisplayUrl": null,
    "timerSeconds": 300
  }
}
```

## Socket.IO Events

### Client → Server

#### `create-room`
Host creates a new game room.

```javascript
socket.emit('create-room', 'Player Name', (response) => {
  // response: { success: true, roomId: 'abc123', room: {...} }
});
```

#### `join-room`
Client joins an existing room.

```javascript
socket.emit('join-room', 'room-id', 'Player Name', (response) => {
  // response: { success: true, room: {...} }
  // response: { success: false, error: 'Room not found' }
});
```

#### `update-settings`
Update room settings (host only).

```javascript
socket.emit('update-settings', { teamSize: 500, timerSeconds: 600 });
```

#### `ready`
Mark player as ready to start.

```javascript
socket.emit('ready');
```

#### `start-game`
Start the game (host only).

```javascript
socket.emit('start-game');
```

#### `game-action`
Send player actions during gameplay.

```javascript
socket.emit('game-action', { type: 'move', data: {...} });
```

#### `leave-room`
Player leaves the room.

```javascript
socket.emit('leave-room');
```

### Server → Client

#### `players-updated`
Emitted when the player list changes.

#### `settings-updated`
Emitted when room settings change.

#### `game-started`
Emitted when the host starts the game.

#### `game-snapshot`
Game state update with current game frame.

```javascript
socket.on('game-snapshot', (data) => {
  // data: { frameNumber, gameState, ... }
});
```

#### `player-left`
Emitted when a player disconnects or leaves.

## Environment Variables

- `PORT` - Server port (default: `3000`)

## Project Structure

- `server.js` - Main server entry point
- `package.json` - Node.js dependencies and scripts

## Client Integration

The game client connects to this server and:

1. Creates or joins a room via Socket.IO
2. Receives the room list from `GET /rooms`
3. Synchronizes game state through `game-snapshot` events
4. Sends player actions through `game-action` events
5. Manages players, settings, and match lifecycle

## Notes

- Uses Express for HTTP endpoints and Socket.IO for real-time communication
- Rooms persist in memory only; they are lost on server restart
- CORS is enabled to support browser clients from any origin