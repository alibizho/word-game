# Word Chain Game

A multiplayer word chain game you can play over your local network in real time. Built with Node.js, Express, and WebSockets, players take turns creating words where each new word must start with the last letter of the previous one.

## 🎮 How to Play

1. **Create a Room**: Click "Create" to start a new game room
2. **Share Room Code**: Share the 6-character room code with a friend
3. **Join Game**: The second player enters the room code to join
4. **Play**: Take turns submitting words that start with the last letter of the previous word
5. **Win**: The last player standing wins!


## 🛠️ Tech Stack

- **Backend**: Node.js, Express
- **Real-time Communication**: WebSockets (ws library)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Word Validation**: Dictionary API (dictionaryapi.dev)

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## ⚙️ Installation & Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/alibizho/word-game.git
   cd wordgame
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open your browser**
   Navigate to `http://localhost:3000`

## 🎯 Game Rules

- Each word must start with the last letter of the previous word
- Words cannot be repeated within the same game
- Players have 3 lives each
- Invalid words result in losing a life
- The game ends when a player runs out of lives

## 🏗️ Project Structure

```
wordgame/
├── server.js          # Main server file with WebSocket handling
├── public/
│   ├── index.html     # Game interface
│   └── styles.css     # Styling
├── package.json       # Dependencies and scripts
└── README.md         # This file
```

## 🔧 Development

The server runs on port 3000 by default. You can change this by setting the `PORT` environment variable:

```bash
PORT=8080 npm start
```

- Dictionary API provided by [dictionaryapi.dev](https://dictionaryapi.dev/)