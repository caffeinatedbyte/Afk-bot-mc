// Import necessary libraries
const express = require("express");
const http = require("http");
const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const AutoAuth = require("mineflayer-auto-auth");
const readline = require("readline");
const { Vec3 } = require("vec3");

// --- Configuration ---
// Production configuration uses environment variables for sensitive data and settings.
// Default values are provided but environment variables take precedence.

const BOT_USERNAME = process.env.MC_USERNAME || "sanx";
const SERVER_HOST = process.env.MC_SERVER_HOST || "billismp.falixsrv.me";
const SERVER_PORT = parseInt(process.env.MC_SERVER_PORT) || 13246;

// AutoAuth Configuration: Uses mineflayer-auto-auth.
// Defaults to using the username if no password env var is set.
const AUTO_AUTH_PASSWORD = process.env.MC_PASSWORD || BOT_USERNAME;

// Increased reconnection delay to be less aggressive
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY) || 60000; // ms (Increased to 1 minute)
const WANDER_INTERVAL = parseInt(process.env.WANDER_INTERVAL) || 10000; // ms
const PATH_STOP_DELAY_TICKS = parseInt(process.env.PATH_STOP_DELAY_TICKS) || 10; // ticks
const RANDOM_MOVE_TICKS = parseInt(process.env.RANDOM_MOVE_TICKS) || 40; // ticks

const CLOSE_PLAYER_JUMP_RADIUS = parseInt(process.env.CLOSE_PLAYER_JUMP_RADIUS) || 3; // blocks
const JUMP_CHECK_INTERVAL = parseInt(process.env.JUMP_CHECK_INTERVAL) || 500; // ms


// --- Logging ---
// Centralized logging function. In production, replace with a robust library.
// Logs 'info', 'warn', and 'error' levels.
function log(level, message, ...args) {
    const levelsToLog = ['info', 'warn', 'error'];
    if (!levelsToLog.includes(level)) {
        return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') {
        console.error(logMessage, ...args);
    } else {
        console.log(logMessage, ...args);
    }
}

// --- Web Server Setup ---
// Simple Express server for keep-alive functionality on hosting platforms.
const app = express();
app.use(express.json());

// Serves index.html for keep-alive pings and basic status check.
app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));

// Starts the web server on the hosting environment's assigned port.
const webServer = app.listen(process.env.PORT || 20759, () => {
    log('info', `Web server running on port ${process.env.PORT || 20759}`);
});

// Keep-alive mechanism removed as requested.


// --- Global Variables ---
let bot; // mineflayer bot instance
let mcData; // Minecraft data for bot's version
let defaultMovements; // Pathfinder movement options
let isWandering = false; // State for random wandering movement

// --- Bot Creation Function ---
function createBot() {
  log('info', `Attempting to connect bot ${BOT_USERNAME} to ${SERVER_HOST}:${SERVER_PORT}`);
  try {
      bot = mineflayer.createBot({
        host: SERVER_HOST,
        port: SERVER_PORT,
        username: BOT_USERNAME,
        version: false, // Auto-detect version
        plugins: [AutoAuth],
        AutoAuth: AUTO_AUTH_PASSWORD,
      });

      // Load plugins
      bot.loadPlugin(pathfinder);

      // --- Bot Event Handlers ---
      bot.once("spawn", onSpawn);
      bot.on("chat", onChat);
      bot.on("playerCollect", onPlayerCollect);
      bot.on("kicked", onKicked);
      bot.on("error", onError); // onError already logs the error
      bot.on("end", onEnd);

      // Pathfinder update listener
      bot.on('path_update', (results) => {
        try {
            if (results.status === 'stopped') {
              if (isWandering) {
                isWandering = false;
                log('info', 'Wandering path stopped.');
              }
            } else if (results.status === 'success') {
                log('info', 'Pathfinding goal reached.');
            } else if (results.status === 'noPath') {
                log('warn', 'No path found to goal.');
            }
        } catch (err) {
            log('error', 'Error in path_update handler:', err);
        }
      });
  } catch (err) {
      log('error', 'Error creating bot instance:', err);
      // Attempt to recreate the bot after a delay if creation fails
      setTimeout(createBot, RECONNECT_DELAY);
  }
}

// --- Event Handlers Implementation ---

// Handles bot spawning and initial setup.
async function onSpawn() {
  log('info', `Bot ${BOT_USERNAME} spawned in version ${bot.version}`);
  try {
      mcData = require("minecraft-data")(bot.version);
      defaultMovements = new Movements(bot, mcData);

      // Configure movement capabilities
      defaultMovements.canJumpWhenMoving = true;
      defaultMovements.allowParkour = true;
      defaultMovements.allowFreeMotion = true;
      defaultMovements.canDig = false;
      defaultMovements.canBuild = false;

      bot.pathfinder.setMovements(defaultMovements);

      log('info', `Bot ${BOT_USERNAME} is up and running!`);

      // Log connected players (excluding the bot).
      if (bot && bot.players) {
          const playerCount = Object.keys(bot.players).length;
          const otherPlayersCount = playerCount > 0 ? playerCount - 1 : 0;
          log('info', `Currently connected players: ${otherPlayersCount}`);
      } else {
          log('warn', "Could not retrieve player list on spawn.");
      }

      startWanderingLoop();
      startClosePlayerJumpLoop();

  } catch (err) {
      log('error', 'Error during onSpawn setup:', err);
      // Note: Errors here might leave the bot in an inconsistent state.
      // Depending on the error, a full reconnect might be necessary.
  }
}

// Handles incoming chat messages.
function onChat(username, message) {
  try {
      // Log chat messages from other players to the console.
      if (username !== bot.username) {
        console.log(`[${username}] ${message}`);
      }
      // Removed any chat command handling, bot only logs messages now.

  } catch (err) {
      log('error', 'Error in onChat handler:', err);
  }
}

// Handles item collection by the bot.
function onPlayerCollect(collector, itemDrop) {
  try {
      // Check if the entity that collected the item is the bot itself.
      if (collector.id === bot.entity.id) {
        const item = itemDrop.item;
        // Toss collected items as the bot doesn't manage inventory for use.
        if (item) {
            bot.tossStack(item).catch(err => log('error', 'Failed to toss item:', err.message));
        }
      }
  } catch (err) {
      log('error', 'Error in onPlayerCollect handler:', err);
  }
}

// Handles bot being kicked from the server.
function onKicked(reason) {
  log('warn', "Bot kicked:", reason);
  log('info', `Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds...`);
  try {
      // Stop all actions and attempt to reconnect.
      stopAllBotActions();
      setTimeout(createBot, RECONNECT_DELAY);
  } catch (err) {
      log('error', 'Error in onKicked handler:', err);
      // Even if stopping actions fails, still attempt to reconnect
      setTimeout(createBot, RECONNECT_DELAY);
  }
}

// Handles general bot errors.
function onError(err) {
  // The existing onError function already logs the error.
  log('error', "Bot error:", err);
  // Rely on the 'end' event for reconnection logic after errors.
}

// Handles bot disconnection from the server.
function onEnd(reason) {
  log('warn', "Bot disconnected. Reason:", reason);
  log('info', `Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds...`);
  try {
      // Stop all actions and attempt to reconnect.
      stopAllBotActions();
      setTimeout(createBot, RECONNECT_DELAY);
  } catch (err) {
      log('error', 'Error in onEnd handler:', err);
      // Even if stopping actions fails, still attempt to reconnect
      setTimeout(createBot, RECONNECT_DELAY);
  }
}

// --- Behavior Loops ---

// Periodically triggers a simple random movement when the bot is idle.
function startWanderingLoop() {
    setInterval(async () => {
        try {
            // Skip if bot is busy or already wandering.
            if (!bot || !bot.pathfinder || bot.pathfinder.isMoving() || isWandering) {
                return;
            }

            isWandering = true;

            try {
                // Move in a random direction for a short duration.
                const directions = ['forward', 'back', 'left', 'right'];
                const randomDirection = directions[Math.floor(Math.random() * directions.length)];

                bot.setControlState(randomDirection, true);

                // 50% chance to jump during movement.
                if (Math.random() > 0.5) {
                     bot.setControlState('jump', true);
                }

                await bot.waitForTicks(RANDOM_MOVE_TICKS);

            } catch (err) {
                log('error', "Random movement failed:", err.message);
            } finally {
                // Ensure controls are reset after movement.
                if (bot) {
                    bot.setControlState('forward', false);
                    bot.setControlState('back', false);
                    bot.setControlState('left', false);
                    bot.setControlState('right', false);
                    bot.setControlState('jump', false);
                }
                isWandering = false;
            }
        } catch (err) {
             log('error', 'Error in startWanderingLoop interval:', err);
        }
    }, WANDER_INTERVAL);
}

// Helper function to stop all current bot actions (wandering and pathfinding).
function stopAllBotActions() {
    try {
        log('info', 'Stopping all bot actions.');
        // Stop any current wandering movement.
        if (isWandering) {
            isWandering = false;
            // Reset movement controls if they were set by wandering.
            if (bot) {
                bot.setControlState('forward', false);
                bot.setControlState('back', false);
                bot.setControlState('left', false);
                bot.setControlState('right', false);
                bot.setControlState('jump', false);
            }
        }
        // Stop any pathfinding in progress.
        if (bot && bot.pathfinder && bot.pathfinder.isMoving()) {
            bot.pathfinder.stop();
            log('info', 'Pathfinder stopped.');
        } else if (bot && bot.pathfinder) {
             // If pathfinder exists but wasn't moving, still log info.
             log('info', 'Pathfinder was not active.');
        }
        // Ensure jump control is off regardless of state.
         if (bot && bot.controlState && bot.controlState.jump) {
             bot.setControlState('jump', false);
         }
    } catch (err) {
        log('error', 'Error in stopAllBotActions:', err);
    }
}


// Periodically checks for very close players and triggers a jump.
function startClosePlayerJumpLoop() {
    setInterval(() => {
        try {
            // Skip if bot is busy with pathfinding.
            if (!bot || !bot.entity || (bot && bot.pathfinder && bot.pathfinder.isMoving())) {
                return;
            }

            // Find players within the close jump radius (excluding the bot).
            const veryClosePlayers = Object.values(bot.players).filter(p =>
                p.entity &&
                p.username !== bot.username &&
                bot.entity.position.distanceTo(p.entity.position) <= CLOSE_PLAYER_JUMP_RADIUS
            );

            // Jump if close players are found and bot is not already jumping.
            if (veryClosePlayers.length > 0) {
                if (bot && !bot.controlState.jump) {
                    bot.setControlState('jump', true);
                    // Release jump control after a short delay.
                    setTimeout(() => {
                        try {
                            if (bot) {
                                bot.setControlState('jump', false);
                            }
                        } catch (err) {
                            log('error', 'Error in jump timeout:', err);
                        }
                    }, 100);
                }
            } else {
                // Ensure jump control is off if no close players.
                if (bot && bot.controlState.jump) {
                    bot.setControlState('jump', false);
                }
            }
        } catch (err) {
            log('error', 'Error in startClosePlayerJumpLoop interval:', err);
        }
    }, JUMP_CHECK_INTERVAL);
}


// --- Console Input Handling ---
// Handles input from the console for sending chat messages.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Process each line of console input.
rl.on("line", (input) => {
  try {
      // Check if bot and chat are available before proceeding
      if (!bot || !bot.chat) {
        log('warn', "Bot not ready to send message.");
        return; // Exit the handler if not ready
      }

      // Send input as a regular chat message.
      const chatPromise = bot.chat(input);

      // Safely attach the catch handler to the promise returned by bot.chat
      if (chatPromise && typeof chatPromise.catch === 'function') {
          chatPromise.catch(err => log('error', 'Failed to send chat message:', err.message));
      } else {
          // This case is unexpected if bot.chat exists and is functioning normally,
          // but provides a fallback log if the return value isn't a catchable Promise.
          log('warn', 'bot.chat did not return a catchable Promise.');
      }

  } catch (err) {
      // This catch block handles errors *within* the try block of the rl.on('line') handler itself.
      log('error', 'Error in console input handler:', err);
  }
});

// --- Graceful Shutdown ---
// Handles process termination signals (SIGINT, SIGTERM) for clean shutdown.
process.on('SIGINT', () => {
    log('info', 'Received SIGINT signal. Shutting down gracefully...');
    try {
        // Stop all bot actions before disconnecting.
        stopAllBotActions();
        if (bot && bot.end) {
            bot.end('Shutting down'); // Disconnect the bot from the server
            log('info', 'Bot disconnecting from server.');
        }
        // Close the web server.
        if (webServer) {
            webServer.close(() => {
                log('info', 'Web server closed.');
                process.exit(0); // Exit cleanly
            });
        } else {
            process.exit(0); // Exit if no web server
        }
    } catch (err) {
        log('error', 'Error during SIGINT shutdown:', err);
        process.exit(1); // Exit with error code
    }
});

process.on('SIGTERM', () => {
    log('info', 'Received SIGTERM signal. Shutting down gracefully...');
    try {
        // Stop all bot actions before disconnecting.
        stopAllBotActions();
        if (bot && bot.end) {
            bot.end('Shutting down'); // Disconnect the bot from the server
            log('info', 'Bot disconnecting from server.');
        }
        // Close the web server.
        if (webServer) {
            webServer.close(() => {
                log('info', 'Web server closed.');
                process.exit(0); // Exit cleanly
            });
        } else {
            process.exit(0); // Exit if no web server
        }
    } catch (err) {
        log('error', 'Error during SIGTERM shutdown:', err);
        process.exit(1); // Exit with error code
    }
});


// --- Start the Bot ---
createBot();
