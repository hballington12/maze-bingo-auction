import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

type UserRole = 'none' | 'auctioneer' | 'captain';

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
  captainName: string;
  captainColor: string;
  amount: number;
}

// In production, use relative URL to connect to same host
// In development, use env variable or localhost
const SOCKET_URL = import.meta.env.VITE_SERVER_URL || 
  (window.location.hostname === 'localhost' ? 'http://localhost:3001' : '');

// Utility function to format boss names
const formatBossName = (bossName: string) => {
  return bossName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace('Kril Tsutsaroth', "K'ril Tsutsaroth")
    .replace('Kree Arra', "Kree'Arra")
    .replace('Dagannoth', 'DK')
    .replace('Commander Zilyana', 'Zilyana')
    .replace('General Graardor', 'Graardor')
    .replace('Thermonuclear Smoke Devil', 'Thermy')
    .replace('Corporeal Beast', 'Corp')
    .replace('Kalphite Queen', 'KQ')
    .replace('King Black Dragon', 'KBD');
};

// Pool Usage Component
const PoolUsageIndicator = ({ 
  usage, 
  currentPool, 
  captainName, 
  captainColor 
}: {
  usage: {
    poolUsage: Record<string, { current: number; cap: number; slots: number }>;
    totalSlots: number;
    teamCap: number;
  };
  currentPool?: string;
  captainName?: string;
  captainColor?: string;
}) => {
  return (
    <div className="pool-usage-indicator">
      {captainName && (
        <div className="usage-header" style={{ color: captainColor }}>
          {captainName}
        </div>
      )}
      <div className="usage-grid">
        {Object.entries(usage.poolUsage).map(([pool, poolData]) => {
          const isCurrentPool = pool === currentPool;
          const isAtCap = poolData.current >= poolData.cap;
          const percentage = poolData.cap > 0 ? (poolData.current / poolData.cap) * 100 : 0;
          
          return (
            <div key={pool} className={`usage-pool ${isCurrentPool ? 'current' : ''} ${isAtCap ? 'at-cap' : ''}`}>
              <div className="pool-label">
                {pool}
                {isCurrentPool && <span className="current-indicator">●</span>}
              </div>
              <div className="progress-bar">
                <div 
                  className="progress-fill" 
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: isAtCap ? '#f44336' : isCurrentPool ? '#4caf50' : '#2196f3'
                  }}
                />
              </div>
              <div className="usage-text">
                {poolData.current}/{poolData.cap}
              </div>
            </div>
          );
        })}
        <div className="team-total">
          <span className="team-label">Total:</span>
          <span className={`team-slots ${usage.totalSlots >= usage.teamCap ? 'at-cap' : ''}`}>
            {usage.totalSlots}/{usage.teamCap}
          </span>
        </div>
      </div>
    </div>
  );
};

// Player Card Component
const PlayerCard = ({ player, title, showAllStats = false, showPlayerName = false }: { 
  player: Player, 
  title: string, 
  showAllStats?: boolean,
  showPlayerName?: boolean 
}) => {
  return (
    <div className="player-card-container">
      {showPlayerName && (
        <div className="player-name-display">
          {player.pool === 'Duos' && player.stats.players ? 
            player.stats.players.map((p: any, idx: number) => p.name).join(' & ') :
            player.revealedName || player.name
          }
        </div>
      )}
      <div className="player-card">
        <h4>{title}</h4>
        <div className="stat-columns">
          <div className="stat-column">
            <div className="stat-row-card">
              <span className="stat-label">Combat:</span>
              <span className="stat-value-card">
                {showAllStats || (player.visibleStats?.includes('combat') || !player.visibleStats) ? 
                  player.stats.combat : '?'}
              </span>
            </div>
            <div className="stat-row-card">
              <span className="stat-label">Total:</span>
              <span className="stat-value-card">
                {showAllStats || (player.visibleStats?.includes('total') || !player.visibleStats) ? 
                  player.stats.total : '?'}
              </span>
            </div>
            <div className="stat-row-card">
              <span className="stat-label">EHB:</span>
              <span className="stat-value-card">
                {showAllStats || (player.visibleStats?.includes('ehb') || !player.visibleStats) ? 
                  player.stats.ehb : '?'}
              </span>
            </div>
            <div className="stat-row-card">
              <span className="stat-label">EHP:</span>
              <span className="stat-value-card">
                {showAllStats || (player.visibleStats?.includes('ehp') || !player.visibleStats) ? 
                  player.stats.ehp : '?'}
              </span>
            </div>
            {/* Show boss kills */}
            {showAllStats && player.stats.bosses && Object.entries(player.stats.bosses).slice(0, 3).map(([boss, kills]: [string, any]) => (
              <div key={boss} className="stat-row-card">
                <span className="stat-label">{formatBossName(boss)}:</span>
                <span className="stat-value-card">{kills}</span>
              </div>
            ))}
            {/* Show preview boss kills */}
            {!showAllStats && player.visibleStats?.filter((stat: string) => stat.startsWith('boss_')).slice(0, 3).map((statKey: string) => {
              const boss = statKey.replace('boss_', '');
              return (
                <div key={boss} className="stat-row-card">
                  <span className="stat-label">{formatBossName(boss)}:</span>
                  <span className="stat-value-card">{player.stats.bosses?.[boss] || '?'}</span>
                </div>
              );
            })}
          </div>
          <div className="stat-column">
            {/* Show remaining boss kills when showing all stats */}
            {showAllStats && player.stats.bosses && Object.entries(player.stats.bosses).slice(3).map(([boss, kills]: [string, any]) => (
              <div key={boss} className="stat-row-card">
                <span className="stat-label">{formatBossName(boss)}:</span>
                <span className="stat-value-card">{kills}</span>
              </div>
            ))}
            {/* Show remaining preview boss kills */}
            {!showAllStats && player.visibleStats?.filter((stat: string) => stat.startsWith('boss_')).slice(3).map((statKey: string) => {
              const boss = statKey.replace('boss_', '');
              return (
                <div key={boss} className="stat-row-card">
                  <span className="stat-label">{formatBossName(boss)}:</span>
                  <span className="stat-value-card">{player.stats.bosses?.[boss] || '?'}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [role, setRole] = useState<UserRole>('none');
  const [roomCode, setRoomCode] = useState('');
  const [captainName, setCaptainName] = useState('');
  const [captains, setCaptains] = useState<Captain[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [bidSubmitted, setBidSubmitted] = useState(false);
  const [revealedBids, setRevealedBids] = useState<Bid[]>([]);
  const [currentlyRevealedBids, setCurrentlyRevealedBids] = useState<Bid[]>([]);
  const [winner, setWinner] = useState<Bid | null>(null);
  const [myInfo, setMyInfo] = useState<Captain | null>(null);
  const [auctionState, setAuctionState] = useState<string>('waiting');
  const [totalCaptains, setTotalCaptains] = useState(0);
  const [currentBidsCount, setCurrentBidsCount] = useState(0);
  const [completedPlayers, setCompletedPlayers] = useState<Set<number>>(new Set());
  const [revealPhase, setRevealPhase] = useState<'hidden' | 'stats' | 'username'>('hidden');
  const [revealedPlayer, setRevealedPlayer] = useState<Player | null>(null);
  const [submittedBids, setSubmittedBids] = useState<Set<string>>(new Set());
  
  // Auctioneer specific state
  const [captainCount, setCaptainCount] = useState('4');
  const [initialBudget, setInitialBudget] = useState('1000');
  const [players, setPlayers] = useState<Player[]>([]);
  const [bidsReceived, setBidsReceived] = useState(0);
  
  // Cap and pool tracking state
  const [caps, setCaps] = useState<{
    poolCaps: Record<string, number>;
    teamCap: number;
    originalPoolCounts: Record<string, number>;
  } | null>(null);
  const [remainingPoolCounts, setRemainingPoolCounts] = useState<Record<string, number>>({});
  const [skippedCaptains, setSkippedCaptains] = useState<string[]>([]);
  const [eligibleCaptains, setEligibleCaptains] = useState<string[]>([]);
  const [captainUsageData, setCaptainUsageData] = useState<Array<{
    captainId: string;
    usage: {
      poolUsage: Record<string, { current: number; cap: number; slots: number }>;
      totalSlots: number;
      teamCap: number;
    };
  }>>([]);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
    });

    newSocket.on('error', (error: string) => {
      alert(error);
    });

    newSocket.on('joined-room', ({ captain, state }) => {
      setMyInfo(captain);
      setAuctionState(state);
    });

    newSocket.on('captain-joined', (updatedCaptains: Captain[]) => {
      setCaptains(updatedCaptains);
      setTotalCaptains(updatedCaptains.length);
    });

    newSocket.on('captains-updated', (updatedCaptains: Captain[]) => {
      setCaptains(updatedCaptains);
    });

    newSocket.on('room-state', ({ captains: roomCaptains, players: roomPlayers, state, completedPlayers: roomCompletedPlayers, caps: roomCaps, remainingPoolCounts: roomRemainingPoolCounts, captainUsageData: roomCaptainUsageData }) => {
      setCaptains(roomCaptains);
      setAuctionState(state);
      if (roomPlayers) {
        setPlayers(roomPlayers);
      }
      if (roomCompletedPlayers) {
        setCompletedPlayers(new Set(roomCompletedPlayers));
      }
      if (roomCaps) {
        setCaps(roomCaps);
      }
      if (roomRemainingPoolCounts) {
        setRemainingPoolCounts(roomRemainingPoolCounts);
      }
      if (roomCaptainUsageData) {
        setCaptainUsageData(roomCaptainUsageData);
      }
    });

    newSocket.on('bidding-started', ({ player, skippedCaptains: biddingSkippedCaptains, caps: biddingCaps, remainingPoolCounts: biddingRemainingPoolCounts, eligibleCaptains: biddingEligibleCaptains, captainUsageData: biddingCaptainUsageData }) => {
      setCurrentPlayer(player);
      setRevealedPlayer(null); // Clear previous revealed player
      setAuctionState('bidding');
      setBidSubmitted(false);
      setBidAmount('');
      setRevealedBids([]);
      setWinner(null);
      setCurrentBidsCount(0);
      setSubmittedBids(new Set());
      setRevealPhase('hidden'); // Reset reveal phase
      setSkippedCaptains(biddingSkippedCaptains || []);
      setEligibleCaptains(biddingEligibleCaptains || []);
      if (biddingCaps) setCaps(biddingCaps);
      if (biddingRemainingPoolCounts) setRemainingPoolCounts(biddingRemainingPoolCounts);
      if (biddingCaptainUsageData) setCaptainUsageData(biddingCaptainUsageData);
    });

    newSocket.on('bid-submitted', () => {
      setBidSubmitted(true);
    });

    newSocket.on('player-skipped', ({ player, reason }) => {
      console.log(`Player ${player.name} was skipped: ${reason}`);
      // Could add a toast notification here if desired
    });

    newSocket.on('bid-received', ({ captainId, totalBids, totalCaptains }) => {
      setBidsReceived(totalBids);
      setCurrentBidsCount(totalBids);
      setTotalCaptains(totalCaptains);
      setSubmittedBids(prev => new Set([...prev, captainId]));
      if (totalBids === totalCaptains) {
        setAuctionState('ready-to-reveal');
      }
    });

    newSocket.on('bids-revealed', ({ bids, winner: revealedWinner, updatedCaptains, completedPlayerIndex, auctionedPlayer, message }) => {
      // Handle case where no bids were received
      if (bids.length === 0) {
        console.log('No bids received:', message);
        setRevealedBids([]);
        setCurrentlyRevealedBids([]);
        setWinner(null);
        setCaptains(updatedCaptains);
        setAuctionState('waiting');
        if (auctionedPlayer) {
          setRevealedPlayer(auctionedPlayer);
          setRevealPhase('stats');
        }
        return;
      }
      
      // Sort bids in ascending order for sequential reveal
      const sortedBids = [...bids].sort((a, b) => a.amount - b.amount);
      
      setRevealedBids(sortedBids);
      setCurrentlyRevealedBids([]);
      setWinner(revealedWinner);
      setCaptains(updatedCaptains);
      setAuctionState('revealed');
      setRevealPhase('hidden');
      
      // Start sequential bid reveal
      sortedBids.forEach((bid, index) => {
        setTimeout(() => {
          setCurrentlyRevealedBids(prev => [...prev, bid]);
        }, index * 800); // 800ms delay between each bid reveal
      });
      
      // Store the player for reveal animation
      if (auctionedPlayer) {
        setRevealedPlayer(auctionedPlayer);
        
        // Start reveal animation sequence after all bids are revealed
        const totalBidRevealTime = sortedBids.length * 800 + 1000; // Extra 1 second
        setTimeout(() => {
          setRevealPhase('stats');
          setTimeout(() => {
            setRevealPhase('username');
          }, 2000); // 1 second fade in + 1 second delay
        }, totalBidRevealTime);
      }
      
      // Mark player as completed
      if (completedPlayerIndex !== undefined) {
        setCompletedPlayers(prev => new Set([...prev, completedPlayerIndex]));
      }
      
      // Update my info if I'm a captain
      const myUpdatedInfo = updatedCaptains.find((c: Captain) => c.id === newSocket.id);
      if (myUpdatedInfo) {
        setMyInfo(myUpdatedInfo);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const createRoom = async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captainCount: parseInt(captainCount),
          initialBudget: parseInt(initialBudget),
          maxPlayersPerRound: Math.floor(16 / parseInt(captainCount))
        })
      });
      const { code } = await response.json();
      setRoomCode(code);
      socket?.emit('join-as-auctioneer', code);
      setRole('auctioneer');
    } catch (error) {
      alert('Failed to create room');
    }
  };

  const joinAsAuctioneer = () => {
    if (roomCode.length === 6) {
      socket?.emit('join-as-auctioneer', roomCode.toUpperCase());
      setRole('auctioneer');
    }
  };

  const joinAsCaptain = () => {
    if (roomCode.length === 6 && captainName) {
      socket?.emit('join-as-captain', {
        roomCode: roomCode.toUpperCase(),
        captainName
      });
      setRole('captain');
    }
  };

  const submitBid = () => {
    const amount = parseInt(bidAmount) || 0;
    if (amount >= 0 && amount <= (myInfo?.remainingBudget || 0)) {
      socket?.emit('submit-bid', { roomCode, amount });
    }
  };

  const startBidding = (playerIndex: number) => {
    socket?.emit('start-bidding', { roomCode, playerIndex });
    setBidsReceived(0);
  };

  const getAvailablePlayersByPool = (pool: string) => {
    return players
      .map((player, index) => ({ player, index }))
      .filter(({ player, index }) => player.pool === pool && !completedPlayers.has(index));
  };

  const startRandomBidding = (pool: string) => {
    const availablePlayers = getAvailablePlayersByPool(pool);
    if (availablePlayers.length === 0) {
      alert(`No available players in pool ${pool}`);
      return;
    }
    
    const randomIndex = Math.floor(Math.random() * availablePlayers.length);
    const selectedPlayer = availablePlayers[randomIndex];
    startBidding(selectedPlayer.index);
  };

  const revealBids = () => {
    socket?.emit('reveal-bids', roomCode);
  };

  const addPlayer = () => {
    const newPlayer: Player = {
      id: `player-${Date.now()}`,
      name: `Player ${players.length + 1}`,
      pool: 'A',
      stats: {
        combat: Math.floor(Math.random() * 126) + 3,
        total: Math.floor(Math.random() * 2277) + 32
      }
    };
    const updatedPlayers = [...players, newPlayer];
    setPlayers(updatedPlayers);
    socket?.emit('update-players', { roomCode, players: updatedPlayers });
  };

  // Role selection screen
  if (role === 'none') {
    return (
      <div className="container">
        <h1>Team Auction</h1>
        <div className="role-selection">
          <div className="role-card">
            <h2>Create Auction</h2>
            <input
              type="number"
              placeholder="Number of captains"
              value={captainCount}
              onChange={(e) => setCaptainCount(e.target.value)}
            />
            <input
              type="number"
              placeholder="Initial budget"
              value={initialBudget}
              onChange={(e) => setInitialBudget(e.target.value)}
            />
            <button onClick={createRoom}>Create Room</button>
          </div>
          
          <div className="role-card">
            <h2>Join as Auctioneer</h2>
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button onClick={joinAsAuctioneer}>Join as Auctioneer</button>
          </div>
          
          <div className="role-card">
            <h2>Join as Captain</h2>
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <input
              type="text"
              placeholder="Captain name"
              value={captainName}
              onChange={(e) => setCaptainName(e.target.value)}
            />
            <button onClick={joinAsCaptain}>Join as Captain</button>
          </div>
        </div>
      </div>
    );
  }

  // Auctioneer view
  if (role === 'auctioneer') {
    return (
      <div className="auctioneer-container">
        {/* Top Header with Captains */}
        <div className="auctioneer-header">
          <h1>Auctioneer Dashboard</h1>
          {/* Show room code if no captains have joined yet */}
          {captains.length === 0 && (
            <div className="room-code-display">
              <h2>Room Code: {roomCode}</h2>
              <p>Share this code with captains to get started</p>
            </div>
          )}
          <div className="captains-header">
            {captains.map(captain => (
              <div key={captain.id} className="captain-header-card" style={{borderColor: captain.color}}>
                <div className="captain-header-name" style={{color: captain.color}}>{captain.name}</div>
                <div className="captain-header-budget">${captain.remainingBudget}</div>
                <div className={`captain-header-status ${captain.connected ? 'connected' : 'disconnected'}`}>
                  {captain.connected ? '🟢' : '🔴'}
                </div>
              </div>
            ))}
            <button onClick={() => socket?.emit('reset-budgets', roomCode)} className="reset-budgets-btn">
              Reset Budgets
            </button>
          </div>
        </div>

        {/* Pool Usage Indicators */}
        {captainUsageData.length > 0 && (
          <div className="captain-usage-section">
            <h3>Team Pool Usage</h3>
            <div className="usage-indicators-grid">
              {captainUsageData.map(({ captainId, usage }) => {
                const captain = captains.find(c => c.id === captainId);
                if (!captain) return null;
                
                return (
                  <PoolUsageIndicator
                    key={captainId}
                    usage={usage}
                    currentPool={currentPlayer?.pool}
                    captainName={captain.name}
                    captainColor={captain.color}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Three Column Layout */}
        <div className="auctioneer-main">
          {/* Column 1: Player Pool Selection */}
          <div className="auctioneer-column pool-column">
            <div className="pool-selection-vertical">
              <h3>Bidding Pools</h3>
              {['A', 'B', 'C', 'Duos'].map(pool => {
                const remainingCount = remainingPoolCounts[pool] || 0;
                return (
                  <button
                    key={pool}
                    onClick={() => startRandomBidding(pool)}
                    disabled={auctionState === 'bidding' || remainingCount === 0}
                    className={`pool-button-vertical ${remainingCount === 0 ? 'empty' : ''}`}
                  >
                    Pool {pool} ({remainingCount}/{caps?.originalPoolCounts[pool] || 0})
                  </button>
                );
              })}
            </div>

            {/* Captain Bid Status when bidding */}
            {auctionState === 'bidding' && (
              <div className="captain-bid-status-compact">
                <h4>Bid Status:</h4>
                {captains.map(captain => {
                  const hasSubmitted = submittedBids.has(captain.id);
                  const isSkipped = skippedCaptains.includes(captain.id);
                  return (
                    <div key={captain.id} className={`captain-status-compact ${isSkipped ? 'skipped' : ''}`}>
                      <span style={{color: captain.color}}>{captain.name}</span>
                      <span className={`status-light ${isSkipped ? 'skipped' : hasSubmitted ? 'submitted' : 'pending'}`}>
                        {isSkipped ? '⚠️' : hasSubmitted ? '✓' : '○'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {auctionState === 'ready-to-reveal' && (
              <div className="reveal-section-compact">
                <button onClick={revealBids} className="reveal-button">Reveal Bids</button>
              </div>
            )}
          </div>

          {/* Column 2: Current Player Card */}
          <div className="auctioneer-column player-column">
            {(currentPlayer || revealedPlayer) && (
              <div className="current-player-display">
                <div className="pool-header-compact">
                  Pool {currentPlayer ? currentPlayer.pool : revealedPlayer?.pool}
                </div>
                <PlayerCard 
                  player={revealedPlayer || currentPlayer} 
                  title={auctionState === 'revealed' ? "Complete Player Stats" : "Current Auction"}
                  showAllStats={auctionState === 'revealed'}
                  showPlayerName={auctionState === 'revealed' && (revealPhase === 'stats' || revealPhase === 'username')}
                />
                {auctionState === 'revealed' && revealedPlayer && revealedPlayer.pool === 'Duos' && revealedPlayer.stats.players && (
                  <div className="duo-details">
                    {revealedPlayer.stats.players.map((player: any, idx: number) => (
                      <div key={idx} className="duo-player">
                        <h4>Player {idx + 1}</h4>
                        <div className="stat-row">
                          <span>Combat:</span>
                          <span>{player.combat}</span>
                        </div>
                        <div className="stat-row">
                          <span>Total:</span>
                          <span>{player.total}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Column 3: Revealed Bids */}
          <div className="auctioneer-column bids-column">
            {auctionState === 'revealed' && revealedBids.length > 0 && (
              <div className="bids-display-compact">
                <h3>Revealed Bids</h3>
                {revealedBids.map((bid, index) => {
                  const isRevealed = currentlyRevealedBids.some(revealedBid => 
                    revealedBid.captainName === bid.captainName && revealedBid.amount === bid.amount
                  );
                  const isWinner = winner && winner.captainName === bid.captainName && winner.amount === bid.amount;
                  return (
                    <div key={index} className={`bid-reveal-compact ${isRevealed ? 'revealed' : 'hidden'} ${isWinner ? 'winner-bid' : ''}`} style={{borderColor: bid.captainColor}}>
                      <span>{bid.captainName}</span>
                      <span>${bid.amount}</span>
                    </div>
                  );
                })}
                {winner && currentlyRevealedBids.length === revealedBids.length && (
                  <div className="winner-announcement-compact">
                    🏆 {winner.captainName} - ${winner.amount}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom: Captain Rosters */}
        <div className="captain-rosters">
          <h3>Team Rosters</h3>
          <div className="rosters-grid">
            {captains.map(captain => (
              <div key={captain.id} className="roster-column" style={{borderColor: captain.color}}>
                <div className="roster-header" style={{backgroundColor: captain.color}}>
                  {captain.name}
                </div>
                <div className="roster-players">
                  {captain.roster.length === 0 ? (
                    <div className="no-players">No players yet</div>
                  ) : (
                    captain.roster.map((player, idx) => (
                      <div key={idx} className="roster-player">
                        {player.pool === 'Duos' && player.stats.players ? 
                          player.stats.players.map((p: any) => p.name).join(' & ') :
                          player.revealedName || player.name
                        }
                        <span className="roster-pool">({player.pool})</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Captain view
  if (role === 'captain') {
    return (
      <div className="container">
        <h1>Captain: {myInfo?.name}</h1>
        <div className="captain-info" style={{borderColor: myInfo?.color}}>
          <div className="captain-stat">
            <span className="stat-label">Budget</span>
            <span className="stat-value">${myInfo?.remainingBudget}</span>
          </div>
          <div className="captain-stat">
            <span className="stat-label">Players</span>
            <span className="stat-value">{myInfo?.roster.length}</span>
          </div>
        </div>

        {/* Pool Usage for Captain */}
        {myInfo && captainUsageData.length > 0 && (
          <div className="captain-pool-usage">
            {(() => {
              const myCaptainUsage = captainUsageData.find(data => data.captainId === myInfo.id);
              if (!myCaptainUsage) return null;
              
              return (
                <div className="my-usage-section">
                  <h3>Your Pool Usage</h3>
                  <PoolUsageIndicator
                    usage={myCaptainUsage.usage}
                    currentPool={currentPlayer?.pool}
                  />
                </div>
              );
            })()}
          </div>
        )}

        {auctionState === 'waiting' && (
          <div className="waiting-message">
            <h2>Waiting for next round...</h2>
          </div>
        )}

        {auctionState === 'bidding' && currentPlayer && (
          <div className="bidding-interface">
            <h2>Current Player</h2>
            <div className="player-display">
              <div className="pool-header">
                Pool {currentPlayer.pool} ({remainingPoolCounts[currentPlayer.pool] || 0} remaining)
              </div>
              <PlayerCard 
                player={currentPlayer} 
                title="Player Stats Card" 
              />
            </div>

            {/* Show skip status if captain is skipped */}
            {myInfo && skippedCaptains.includes(myInfo.id) && (
              <div className="skip-status">
                <p className="skip-message">⚠️ You cannot bid on this player - at capacity limits</p>
                <div className="cap-info">
                  <small>
                    Pool Cap: {caps?.poolCaps[currentPlayer.pool] || 0} | 
                    Team Cap: {caps?.teamCap || 0}
                  </small>
                </div>
              </div>
            )}

            <div className="bidding-status-captain">
              {currentBidsCount === totalCaptains ? 
                <p className="waiting-reveal">🔄 All bids in! Waiting for auctioneer to reveal...</p> :
                <p>⏳ {bidSubmitted ? 'Waiting for other captains to bid...' : 'Submit your bid below'}</p>
              }
            </div>
            
            {!bidSubmitted && myInfo && !skippedCaptains.includes(myInfo.id) ? (
              <div className="bid-form">
                <input
                  type="number"
                  placeholder="Bid amount (0 allowed)"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  min="0"
                  max={myInfo?.remainingBudget}
                />
                <button onClick={submitBid}>Submit Bid</button>
                <div className="budget-hint">Max: ${myInfo?.remainingBudget}</div>
              </div>
            ) : (
              <div className="bid-confirmation">
                ✅ Bid submitted: ${bidAmount}
              </div>
            )}
          </div>
        )}

        {auctionState === 'revealed' && revealedBids.length > 0 && (
          <div className="results-display">
            <h2>Bidding Results</h2>
            {revealedBids.map((bid, index) => {
              const isRevealed = currentlyRevealedBids.some(revealedBid => 
                revealedBid.captainName === bid.captainName && revealedBid.amount === bid.amount
              );
              const isWinner = winner && winner.captainName === bid.captainName && winner.amount === bid.amount;
              return (
                <div key={index} className={`bid-result ${isRevealed ? 'revealed' : 'hidden'} ${isWinner ? 'winner-bid' : ''}`} style={{borderColor: bid.captainColor}}>
                  <span>{bid.captainName}</span>
                  <span>${bid.amount}</span>
                </div>
              );
            })}
            {winner && currentlyRevealedBids.length === revealedBids.length && (
              <div className="winner-display">
                {winner.captainName === myInfo?.name ? '🎉 You won!' : `${winner.captainName} won with $${winner.amount}`}
              </div>
            )}
            
            {revealedPlayer && (
              <div className="player-reveal">
                <h3>Player Reveal</h3>
                <div className="reveal-card">
                  <div className="reveal-pool">Pool {revealedPlayer.pool}</div>
                  
                  <div className={`reveal-stats ${revealPhase === 'stats' || revealPhase === 'username' ? 'visible' : ''}`}>
                    <PlayerCard 
                      player={revealedPlayer} 
                      title="Complete Player Stats"
                      showAllStats={true}
                      showPlayerName={revealPhase === 'username'}
                    />
                    {revealedPlayer.pool === 'Duos' && revealedPlayer.stats.players && (
                      <div className="duo-details">
                        {revealedPlayer.stats.players.map((player: any, idx: number) => (
                          <div key={idx} className="duo-player">
                            <h4>Player {idx + 1}</h4>
                            <div className="stat-row">
                              <span>Combat:</span>
                              <span>{player.combat}</span>
                            </div>
                            <div className="stat-row">
                              <span>Total:</span>
                              <span>{player.total}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  
                </div>
              </div>
            )}
          </div>
        )}

        <div className="my-roster">
          <h3>My Roster</h3>
          {myInfo?.roster.length === 0 ? (
            <p>No players yet</p>
          ) : (
            <div className="roster-list">
              {myInfo?.roster.map((player) => (
                <div key={player.id} className="roster-player">
                  {player.name} - Pool {player.pool}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return <div>Loading...</div>;
}

export default App;
