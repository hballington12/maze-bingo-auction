import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Serve static files from the client build directory in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  
  // Handle client-side routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Types
interface Captain {
  id: string;
  name: string;
  color: string;
  budget: number;
  remainingBudget: number;
  roster: Player[];
  connected: boolean;
}

interface Player {
  id: string;
  name: string;
  pool: string;
  stats: Record<string, any>;
  revealedName?: string;
}

interface Bid {
  captainId: string;
  amount: number;
  timestamp: number;
}

interface AuctionRoom {
  code: string;
  captains: Map<string, Captain>;
  players: Player[];
  currentPlayerIndex: number;
  currentPool: string;
  currentBids: Map<string, Bid>;
  completedPlayers: Set<number>;
  state: 'setup' | 'waiting' | 'bidding' | 'revealing' | 'complete';
  auctioneerSocket?: string;
  skippedCaptains: Set<string>;
  settings: {
    initialBudget: number;
    maxPlayersPerRound: number;
  };
  caps: {
    poolCaps: Record<string, number>; // max players per pool per team
    teamCap: number; // max total players per team
    originalPoolCounts: Record<string, number>; // original counts per pool
  };
}

// Store rooms in memory
const rooms = new Map<string, AuctionRoom>();

// Generate room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Captain colors
const CAPTAIN_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

// Calculate room caps based on players and team count
function calculateRoomCaps(players: Player[], teamCount: number) {
  const poolCounts: Record<string, number> = {};
  let totalPlayerSlots = 0;
  
  // Count players in each pool
  players.forEach(player => {
    poolCounts[player.pool] = (poolCounts[player.pool] || 0) + 1;
    // Duos count as 2 player slots for team cap calculation
    totalPlayerSlots += player.pool === 'Duos' ? 2 : 1;
  });
  
  // Calculate pool caps (max players per pool per team)
  const poolCaps: Record<string, number> = {};
  Object.keys(poolCounts).forEach(pool => {
    poolCaps[pool] = Math.ceil(poolCounts[pool] / teamCount);
  });
  
  // Calculate team cap (max total players per team)
  const teamCap = Math.ceil(totalPlayerSlots / teamCount);
  
  // Debug logging
  console.log('Cap Calculation Debug:');
  console.log('- Team count:', teamCount);
  console.log('- Pool counts:', poolCounts);
  console.log('- Total player slots:', totalPlayerSlots);
  console.log('- Pool caps:', poolCaps);
  console.log('- Team cap:', teamCap);
  
  return {
    poolCaps,
    teamCap,
    originalPoolCounts: { ...poolCounts }
  };
}

// Check if captain can bid for current player
function canCaptainBid(captain: Captain, currentPlayer: Player, caps: any): boolean {
  // Count current players in captain's roster by pool
  const poolCounts: Record<string, number> = {};
  let totalPlayers = 0;
  
  captain.roster.forEach(player => {
    poolCounts[player.pool] = (poolCounts[player.pool] || 0) + 1;
    totalPlayers += player.pool === 'Duos' ? 2 : 1;
  });
  
  // Check pool cap
  const currentPoolCount = poolCounts[currentPlayer.pool] || 0;
  if (currentPoolCount >= caps.poolCaps[currentPlayer.pool]) {
    return false;
  }
  
  // Check team cap
  const additionalSlots = currentPlayer.pool === 'Duos' ? 2 : 1;
  if (totalPlayers + additionalSlots > caps.teamCap) {
    return false;
  }
  
  return true;
}

// Get remaining players count by pool
function getRemainingPoolCounts(players: Player[], completedPlayers: Set<number>, currentPlayerIndex?: number): Record<string, number> {
  const remaining: Record<string, number> = {};
  
  players.forEach((player, index) => {
    // Exclude completed players and the currently bidding player
    if (!completedPlayers.has(index) && index !== currentPlayerIndex) {
      remaining[player.pool] = (remaining[player.pool] || 0) + 1;
    }
  });
  
  return remaining;
}

// Get captain pool usage for display
function getCaptainPoolUsage(captain: Captain, caps: any) {
  const poolUsage: Record<string, { current: number; cap: number; slots: number }> = {};
  let totalSlots = 0;
  
  // Initialize all pools
  Object.keys(caps.poolCaps).forEach(pool => {
    poolUsage[pool] = { current: 0, cap: caps.poolCaps[pool], slots: 0 };
  });
  
  // Count current usage
  captain.roster.forEach(player => {
    if (poolUsage[player.pool]) {
      poolUsage[player.pool].current++;
      const slots = player.pool === 'Duos' ? 2 : 1;
      poolUsage[player.pool].slots += slots;
      totalSlots += slots;
    }
  });
  
  return {
    poolUsage,
    totalSlots,
    teamCap: caps.teamCap
  };
}

// Load player data
function loadPlayerData(): Player[] {
  try {
    const playersPath = path.join(process.cwd(), 'players.json');
    const playersData = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    const allPlayers: Player[] = [];
    let playerId = 0;

    // Load single players from each pool
    Object.entries(playersData.pools).forEach(([poolName, players]: [string, any[]]) => {
      if (poolName !== 'Duos') {
        players.forEach((player: any) => {
          allPlayers.push({
            id: `player-${playerId++}`,
            name: player.name,
            pool: poolName,
            stats: player.stats
          });
        });
      } else {
        // Handle duo players
        players.forEach((duo: any) => {
          allPlayers.push({
            id: `duo-${playerId++}`,
            name: duo.name,
            pool: 'Duos',
            stats: {
              // Show combined stats for duo
              combat: Math.max(duo.players[0].stats.combat, duo.players[1].stats.combat),
              total: duo.players[0].stats.total + duo.players[1].stats.total,
              ehb: duo.players[0].stats.ehb + duo.players[1].stats.ehb,
              ehp: duo.players[0].stats.ehp + duo.players[1].stats.ehp,
              // Combine boss kills from both players
              bosses: Object.keys({...duo.players[0].stats.bosses, ...duo.players[1].stats.bosses})
                .reduce((combined: any, boss: string) => {
                  combined[boss] = (duo.players[0].stats.bosses[boss] || 0) + (duo.players[1].stats.bosses[boss] || 0);
                  return combined;
                }, {}),
              players: duo.players.map((p: any) => ({
                name: p.name,
                ...p.stats
              }))
            }
          });
        });
      }
    });

    return allPlayers;
  } catch (error) {
    console.error('Error loading player data:', error);
    return [];
  }
}

// REST endpoints
app.post('/api/create-room', (req, res) => {
  const { captainCount, initialBudget, maxPlayersPerRound } = req.body;
  
  let code = generateRoomCode();
  while (rooms.has(code)) {
    code = generateRoomCode();
  }
  
  const players = loadPlayerData();
  const caps = calculateRoomCaps(players, captainCount || 4);
  
  const room: AuctionRoom = {
    code,
    captains: new Map(),
    players,
    currentPlayerIndex: 0,
    currentPool: 'A',
    currentBids: new Map(),
    completedPlayers: new Set(),
    state: 'setup',
    skippedCaptains: new Set(),
    caps,
    settings: {
      initialBudget: initialBudget || 1000,
      maxPlayersPerRound: maxPlayersPerRound || 4
    }
  };
  
  rooms.set(code, room);
  res.json({ code });
});

// Socket.io events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('join-as-auctioneer', (roomCode: string) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    room.auctioneerSocket = socket.id;
    socket.join(roomCode);
    const remainingPoolCounts = getRemainingPoolCounts(room.players, room.completedPlayers);
    
    // Add captain pool usage data
    const captainUsageData = Array.from(room.captains.values()).map(captain => ({
      captainId: captain.id,
      usage: getCaptainPoolUsage(captain, room.caps)
    }));
    
    socket.emit('room-state', {
      captains: Array.from(room.captains.values()),
      players: room.players,
      state: room.state,
      currentPlayerIndex: room.currentPlayerIndex,
      settings: room.settings,
      completedPlayers: Array.from(room.completedPlayers),
      caps: room.caps,
      remainingPoolCounts,
      captainUsageData
    });
  });
  
  socket.on('join-as-captain', ({ roomCode, captainName }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Check if captain name already exists
    const existingCaptain = Array.from(room.captains.values()).find(c => c.name === captainName);
    if (existingCaptain) {
      // Reconnection
      existingCaptain.id = socket.id;
      existingCaptain.connected = true;
      room.captains.set(socket.id, existingCaptain);
    } else {
      // New captain
      const captain: Captain = {
        id: socket.id,
        name: captainName,
        color: CAPTAIN_COLORS[room.captains.size % CAPTAIN_COLORS.length],
        budget: room.settings.initialBudget,
        remainingBudget: room.settings.initialBudget,
        roster: [],
        connected: true
      };
      room.captains.set(socket.id, captain);
    }
    
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = 'captain';
    
    // Notify all clients
    io.to(roomCode).emit('captain-joined', Array.from(room.captains.values()));
    socket.emit('joined-room', {
      captain: room.captains.get(socket.id),
      state: room.state
    });
  });
  
  socket.on('update-players', ({ roomCode, players }) => {
    const room = rooms.get(roomCode);
    if (!room || room.auctioneerSocket !== socket.id) return;
    
    room.players = players;
    io.to(roomCode).emit('players-updated', players);
  });
  
  socket.on('start-bidding', ({ roomCode, playerIndex }) => {
    const room = rooms.get(roomCode);
    if (!room || room.auctioneerSocket !== socket.id) return;
    
    // Check if player already has been auctioned
    if (room.completedPlayers.has(playerIndex)) {
      socket.emit('error', 'This player has already been auctioned');
      return;
    }
    
    room.currentPlayerIndex = playerIndex;
    room.currentBids.clear();
    room.skippedCaptains.clear();
    room.state = 'bidding';
    
    const currentPlayer = room.players[playerIndex];
    
    // Check which captains can bid (not at caps)
    const eligibleCaptains: string[] = [];
    room.captains.forEach((captain, captainId) => {
      if (canCaptainBid(captain, currentPlayer, room.caps)) {
        eligibleCaptains.push(captainId);
      } else {
        room.skippedCaptains.add(captainId);
      }
    });
    
    // If no captains can bid, mark player as completed and notify
    if (eligibleCaptains.length === 0) {
      room.completedPlayers.add(playerIndex);
      room.state = 'waiting';
      io.to(roomCode).emit('player-skipped', {
        player: currentPlayer,
        reason: 'No eligible captains (all at capacity limits)'
      });
      return;
    }
    
    // Generate random visible stats for preview
    // Always show: combat, total, and ALL boss kills
    // Hide either EHB or EHP (randomly choose which one to show)
    const guaranteedStats = ['combat', 'total'];
    const optionalEfficiencyStats = ['ehb', 'ehp'];
    const selectedEfficiency = optionalEfficiencyStats[Math.floor(Math.random() * optionalEfficiencyStats.length)];
    
    // ALWAYS show ALL boss kills - never hide them
    const availableBosses = Object.keys(currentPlayer.stats.bosses || {});
    const allBossStats = availableBosses.map(boss => `boss_${boss}`);
    
    const randomStats = [...guaranteedStats, selectedEfficiency, ...allBossStats];
    
    // Create preview player with only visible stats
    const previewPlayer = {
      ...currentPlayer,
      stats: randomStats.reduce((acc, statKey) => {
        if (statKey.startsWith('boss_')) {
          // Handle boss stats - keep the full bosses object
          if (!acc.bosses) acc.bosses = {};
          const bossName = statKey.replace('boss_', '');
          acc.bosses[bossName] = currentPlayer.stats.bosses?.[bossName] || 0;
        } else {
          // Handle regular stats
          acc[statKey] = currentPlayer.stats[statKey];
        }
        return acc;
      }, {} as any),
      visibleStats: randomStats
    };
    
    // Get remaining pool counts for display (exclude currently bidding player)
    const remainingPoolCounts = getRemainingPoolCounts(room.players, room.completedPlayers, room.currentPlayerIndex);
    
    // Add captain pool usage data
    const captainUsageData = Array.from(room.captains.values()).map(captain => ({
      captainId: captain.id,
      usage: getCaptainPoolUsage(captain, room.caps)
    }));
    
    io.to(roomCode).emit('bidding-started', {
      player: previewPlayer,
      playerIndex,
      skippedCaptains: Array.from(room.skippedCaptains),
      caps: room.caps,
      remainingPoolCounts,
      eligibleCaptains,
      captainUsageData
    });
  });
  
  socket.on('submit-bid', ({ roomCode, amount }) => {
    const room = rooms.get(roomCode);
    if (!room || room.state !== 'bidding') return;
    
    const captain = room.captains.get(socket.id);
    if (!captain) return;
    
    // Check if captain is skipped due to caps
    if (room.skippedCaptains.has(socket.id)) {
      socket.emit('bid-error', 'Cannot bid - you are at capacity limits for this player type');
      return;
    }
    
    // Validate bid
    if (amount < 0 || amount > captain.remainingBudget) {
      socket.emit('bid-error', 'Invalid bid amount');
      return;
    }
    
    room.currentBids.set(socket.id, {
      captainId: socket.id,
      amount,
      timestamp: Date.now()
    });
    
    socket.emit('bid-submitted', amount);
    
    // Check if all eligible captains have bid
    const eligibleCaptainsCount = room.captains.size - room.skippedCaptains.size;
    const allBidsReceived = room.currentBids.size >= eligibleCaptainsCount;
    
    // Notify all participants about bid status
    io.to(roomCode).emit('bid-received', {
      captainName: captain.name,
      captainId: socket.id,
      totalBids: room.currentBids.size,
      totalCaptains: eligibleCaptainsCount
    });
    
    // Auto-advance to ready-to-reveal when all eligible captains have bid
    if (allBidsReceived) {
      room.state = 'ready-to-reveal';
    }
  });
  
  socket.on('reset-budgets', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.auctioneerSocket !== socket.id) return;
    
    // Reset all captain budgets to initial amount
    room.captains.forEach(captain => {
      captain.remainingBudget = captain.budget;
    });
    
    // Notify all clients of updated captains
    io.to(roomCode).emit('captains-updated', Array.from(room.captains.values()));
  });

  socket.on('reveal-bids', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.auctioneerSocket !== socket.id) return;
    
    room.state = 'revealing';
    
    // Handle case where no bids exist (all captains skipped)
    if (room.currentBids.size === 0) {
      // Mark player as completed with no winner
      room.completedPlayers.add(room.currentPlayerIndex);
      room.state = 'waiting';
      
      io.to(roomCode).emit('bids-revealed', {
        bids: [],
        winner: null,
        updatedCaptains: Array.from(room.captains.values()),
        completedPlayerIndex: room.currentPlayerIndex,
        auctionedPlayer: room.players[room.currentPlayerIndex],
        message: 'No bids received - all captains at capacity limits'
      });
      return;
    }

    // Find winner with tie-breaking
    let winner: { captain: Captain, bid: Bid } | null = null;
    let highestBid = 0;
    let tiedBidders: { captain: Captain, bid: Bid }[] = [];
    
    room.currentBids.forEach((bid, captainId) => {
      const captain = room.captains.get(captainId);
      if (!captain) return;
      
      if (bid.amount > highestBid) {
        highestBid = bid.amount;
        winner = { captain, bid };
        tiedBidders = [{ captain, bid }];
      } else if (bid.amount === highestBid) {
        tiedBidders.push({ captain, bid });
      }
    });
    
    // Random tie-breaking if multiple highest bids
    if (tiedBidders.length > 1) {
      const randomIndex = Math.floor(Math.random() * tiedBidders.length);
      winner = tiedBidders[randomIndex];
    }
    
    // Update winner's budget and roster
    if (winner) {
      winner.captain.remainingBudget -= winner.bid.amount;
      winner.captain.roster.push(room.players[room.currentPlayerIndex]);
      
      // Mark player as completed
      room.completedPlayers.add(room.currentPlayerIndex);
    }
    
    // Prepare bids for display
    const bidsArray = Array.from(room.currentBids.entries()).map(([captainId, bid]) => ({
      captainName: room.captains.get(captainId)?.name,
      captainColor: room.captains.get(captainId)?.color,
      amount: bid.amount
    }));
    
    io.to(roomCode).emit('bids-revealed', {
      bids: bidsArray,
      winner: winner ? {
        captainName: winner.captain.name,
        captainColor: winner.captain.color,
        amount: winner.bid.amount
      } : null,
      updatedCaptains: Array.from(room.captains.values()),
      completedPlayerIndex: winner ? room.currentPlayerIndex : undefined,
      auctionedPlayer: room.players[room.currentPlayerIndex]
    });
    
    room.state = 'waiting';
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Mark captain as disconnected
    if (socket.data.roomCode && socket.data.role === 'captain') {
      const room = rooms.get(socket.data.roomCode);
      if (room) {
        const captain = room.captains.get(socket.id);
        if (captain) {
          captain.connected = false;
          io.to(socket.data.roomCode).emit('captain-disconnected', captain.name);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});