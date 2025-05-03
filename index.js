// Import necessary libraries
const express = require("express"); // Used for the basic web server (keep-alive)
const http = require("http"); // Used for the basic web server (keep-alive)
const mineflayer = require("mineflayer"); // The core library for interacting with the Minecraft server
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder"); // Pathfinder plugin for navigation
const armorManager = require("mineflayer-armor-manager"); // Armor manager plugin for equipping armor
const AutoAuth = require("mineflayer-auto-auth"); // Plugin for server authentication (e.g., AutoAuth, nLogin)
const readline = require("readline"); // Used for handling console input
const { Vec3 } = require("vec3"); // Vector library for handling positions

// --- Configuration ---
// Production-grade configuration uses environment variables.
// This keeps sensitive information and settings outside the codebase.
// Default values are provided for convenience, but environment variables take precedence.

const BOT_USERNAME = process.env.MC_USERNAME || "sanx"; // The username for the bot. Reads from MC_USERNAME env var, defaults to "sanx".
const SERVER_HOST = process.env.MC_SERVER_HOST || "billismp.falixsrv.me"; // The server address. Reads from MC_SERVER_HOST env var.
const SERVER_PORT = parseInt(process.env.MC_SERVER_PORT) || 13246; // The server port. Reads from MC_SERVER_PORT env var, defaults to 13246. Ensure it's an integer.

// AutoAuth Configuration:
// This uses the mineflayer-auto-auth plugin.
// If your server does not require a password field for authentication,
// AutoAuth often uses the username as the authentication string.
// The default behavior below uses the MC_PASSWORD env var if set, otherwise defaults to the BOT_USERNAME.
// This should work for servers that accept the username as the auth key when no password is required.
const AUTO_AUTH_PASSWORD = process.env.MC_PASSWORD || BOT_USERNAME; // Authentication string for AutoAuth. Reads from MC_PASSWORD env var, defaults to BOT_USERNAME.

// Reconnection Delay
const RECONNECT_DELAY = parseInt(process.env.RECONNECT_DELAY) || 5000; // Delay in milliseconds before attempting to reconnect after disconnection. Reads from RECONNECT_DELAY env var, defaults to 5000ms.

// Wandering and Movement Constants
const WANDER_INTERVAL = parseInt(process.env.WANDER_INTERVAL) || 10000; // How often in milliseconds to trigger a random movement when idle. Reads from WANDER_INTERVAL env var, defaults to 10000ms.
const PATH_STOP_DELAY_TICKS = parseInt(process.env.PATH_STOP_DELAY_TICKS) || 10; // Delay in ticks after stopping a path before potentially starting a new action. Reads from PATH_STOP_DELAY_TICKS env var, defaults to 10 ticks.
const RANDOM_MOVE_TICKS = parseInt(process.env.RANDOM_MOVE_TICKS) || 40; // Duration of the random movement in ticks (20 ticks = 1 second). Reads from RANDOM_MOVE_TICKS env var, defaults to 40 ticks.

// Jumping Constants
const CLOSE_PLAYER_JUMP_RADIUS = parseInt(process.env.CLOSE_PLAYER_JUMP_RADIUS) || 3; // Radius in blocks to check for players to trigger a jump. Reads from CLOSE_PLAYER_JUMP_RADIUS env var, defaults to 3 blocks.
const JUMP_CHECK_INTERVAL = parseInt(process.env.JUMP_CHECK_INTERVAL) || 500; // How often in milliseconds to check for close players to jump. Reads from JUMP_CHECK_INTERVAL env var, defaults to 500ms.


// Inventory Constants (currently only used for armor management)
// This list defines items the armorManager plugin should prioritize equipping.
// Can be extended to include other items the bot might need to keep/manage.
const ITEMS_TO_KEEP = [
  "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", // Example tools
  "diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots", // Diamond armor
  "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots", // Iron armor
];

// --- Logging ---
// A centralized logging function for structured output.
// In a production environment, this would be replaced by a robust logging library
// like Winston or Pino, which can handle log levels, output to files,
// and integrate with external logging services.
// This function handles 'info', 'warn', and 'error' levels.
function log(level, message, ...args) {
    // Define the log levels to process. Debug and chat are excluded here.
    const levelsToLog = ['info', 'warn', 'error'];
    if (!levelsToLog.includes(level)) {
        return; // Only log specified levels
    }

    const timestamp = new Date().toISOString(); // Get current timestamp in ISO format
    // Format the log message with timestamp, level, and message
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    // Use console.error for 'error' level, console.log for others
    if (level === 'error') {
        console.error(logMessage, ...args);
    } else {
        console.log(logMessage, ...args);
    }
}

// --- Web Server Setup ---
// A simple Express server is used primarily to keep the bot process alive
// on platforms like Replit that stop processes without incoming web requests.
const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

// Serve a basic index.html file from the current directory if a GET request is made to the root URL
// This is the endpoint that the keep-alive pings will hit.
app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));

// Start the web server on the specified port (defaults to 3000 if PORT env var not set)
app.listen(process.env.PORT || 3000, () => {
    log('info', `Web server running on port ${process.env.PORT || 3000}`);
});

// Keep-alive mechanism: Periodically ping the web server endpoint.
// This is essential for hosting environments that require web activity to stay alive.
setInterval(() => {
  if (process.env.PROJECT_DOMAIN) { // Check if running in an environment with PROJECT_DOMAIN (like Replit)
    http.get(`http://${process.env.PROJECT_DOMAIN}.repl.co/`).on('error', (err) => {
      log('error', "Keep-alive request failed:", err.message); // Log errors during ping
    });
  }
}, 224000); // Ping every 224000 milliseconds (~3.7 minutes)

// --- Global Variables ---
// These variables hold the bot instance and related data, accessible throughout the script.
let bot; // The mineflayer bot instance
let mcData; // Minecraft data for the bot's specific version (loaded after spawn)
let defaultMovements; // Configured movement options for the pathfinder
let isWandering = false; // Boolean state: true if the bot is currently performing a random wandering movement

// --- Bot Creation Function ---
// This function initializes and configures the mineflayer bot.
function createBot() {
  log('info', `Attempting to connect bot ${BOT_USERNAME} to ${SERVER_HOST}:${SERVER_PORT}`);
  // Create the mineflayer bot instance with specified connection details and plugins
  bot = mineflayer.createBot({
    host: SERVER_HOST, // Server address
    port: SERVER_PORT, // Server port
    username: BOT_USERNAME, // Bot's username
    version: false, // Auto-detect server version based on handshake
    plugins: [AutoAuth], // Load the AutoAuth plugin for authentication
    AutoAuth: AUTO_AUTH_PASSWORD, // Pass the authentication string (password or username) to AutoAuth
  });

  // Load additional plugins after the bot instance is created
  bot.loadPlugin(armorManager); // Load the armor manager plugin
  bot.loadPlugin(pathfinder); // Load the pathfinder plugin

  // --- Bot Event Handlers ---
  // Attach listeners to key bot events.
  bot.once("spawn", onSpawn); // 'spawn' event: triggered when the bot successfully joins and spawns in the world (fires only once per connection)
  bot.on("chat", onChat); // 'chat' event: triggered when a chat message is received
  bot.on("playerCollect", onPlayerCollect); // 'playerCollect' event: triggered when the bot picks up an item/entity
  bot.on("kicked", onKicked); // 'kicked' event: triggered when the bot is kicked from the server
  bot.on("error", onError); // 'error' event: triggered when a critical error occurs in the bot
  bot.on("end", onEnd); // 'end' event: triggered when the bot disconnects from the server

  // Listener for pathfinder updates. Useful for debugging navigation status.
  bot.on('path_update', (results) => {
    // If a path is stopped for any reason (success, no path, or manual stop), reset wandering state
    // This ensures the bot can start a new action after a pathfinding task finishes or is interrupted.
    if (results.status === 'stopped') {
      if (isWandering) {
        isWandering = false;
        log('info', 'Wandering path stopped.'); // Log when wandering is stopped
      }
    } else if (results.status === 'success') {
        log('info', 'Pathfinding goal reached.'); // Log when a pathfinding goal is successfully reached
    } else if (results.status === 'noPath') {
        log('warn', 'No path found to goal.'); // Log a warning if no path could be found
    }
  });
}

// --- Event Handlers Implementation ---

// Handler for the 'spawn' event. This is where initial setup after connecting happens.
async function onSpawn() {
  log('info', `Bot ${BOT_USERNAME} spawned in version ${bot.version}`);
  try {
      // Load Minecraft data specific to the server version the bot connected to.
      // This data is essential for understanding blocks, items, etc.
      mcData = require("minecraft-data")(bot.version);
      // Create default movement options for the pathfinder using the loaded mcData.
      defaultMovements = new Movements(bot, mcData);

      // Configure movement capabilities for the pathfinder.
      // These settings determine what the bot can do while navigating.
      defaultMovements.canJumpWhenMoving = true; // Allow jumping while moving (helps with small obstacles)
      defaultMovements.allowParkour = true; // Allow simple parkour maneuvers (e.g., jumping across 1-block gaps)
      defaultMovements.allowFreeMotion = true; // Allow more direct movement in open areas (less strict grid adherence)
      defaultMovements.canDig = false; // Explicitly prevent the bot from digging blocks
      defaultMovements.canBuild = false; // Explicitly prevent the bot from placing blocks

      // Set the configured movements for the pathfinder plugin.
      bot.pathfinder.setMovements(defaultMovements);

      // Use the armorManager plugin to automatically equip the best armor found in inventory.
      await bot.armorManager.equipAll();
      log('info', 'Equipped best armor.');

      // Log that the bot is fully ready and operational.
      log('info', `Bot ${BOT_USERNAME} is up and running!`);

      // Check and log the number of connected players on spawn (excluding the bot itself).
      if (bot && bot.players) { // Ensure bot and players object exist
          const playerCount = Object.keys(bot.players).length; // Get total count including bot
          const otherPlayersCount = playerCount > 0 ? playerCount - 1 : 0; // Subtract 1 for bot, handle case of 0 players
          log('info', `Currently connected players: ${otherPlayersCount}`);
      } else {
          log('warn', "Could not retrieve player list on spawn."); // Log warning if player list is unavailable
      }

      // Start the main wandering behavior loop.
      startWanderingLoop();

      // Start the loop to check for close players and trigger a jump.
      startClosePlayerJumpLoop();

  } catch (err) {
      // Log any errors that occur during the spawn setup process.
      log('error', 'Error during onSpawn setup:', err);
      // In a production scenario, you might add more robust error handling here,
      // possibly attempting to restart the bot in a controlled manner.
  }
}

// Handler for incoming chat messages.
function onChat(username, message) {
  // Log chat messages from other players to the console.
  // This provides visibility into server chat from the bot's console.
  if (username !== bot.username) { // Don't log the bot's own messages
    console.log(`[${username}] ${message}`); // Use standard console.log for chat visibility
  }

  // Handle the "stop" command received in chat.
  if (message === "stop") {
    stopWandering(); // Stop any current random wandering movement.
    if (bot && bot.pathfinder) { // Ensure bot and pathfinder exist before stopping
        bot.pathfinder.stop(); // Ensure the pathfinder is stopped (important if it was doing something else)
    }
    // Send a confirmation message in chat. Add error handling for sending the message.
    bot.chat("Stopping current actions.").catch(err => log('error', 'Failed to send chat message:', err.message));
    log('info', 'Stop command received.'); // Log the command reception
  }
}

// Handler for when the bot collects an item or entity.
function onPlayerCollect(collector, itemDrop) {
  // Check if the entity that collected the item is the bot itself.
  if (collector.id === bot.entity.id) {
    const item = itemDrop.item; // Get the item object from the item drop.
    // If the collected entity has an 'item' property (indicating it's an item stack or similar), toss it.
    // The bot is configured to only wander, so it doesn't need to keep collected items.
    if (item) {
        // Use tossStack to drop the item. Use .catch to handle potential errors asynchronously.
        bot.tossStack(item).catch(err => log('error', 'Failed to toss item:', err.message));
    }
  }
}

// Handler for when the bot is kicked from the server.
function onKicked(reason) {
  log('warn', "Bot kicked:", reason); // Log the kick reason as a warning.
  log('info', `Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds...`); // Inform about the reconnection attempt.

  // Clean up any ongoing activities before attempting to reconnect.
  stopWandering(); // Stop any random wandering movement.
  if (bot && bot.pathfinder) { // Ensure bot and pathfinder exist before stopping
      bot.pathfinder.stop(); // Stop any pathfinding in progress.
  }
  // Note: Mineflayer usually handles internal cleanup on 'end' which follows 'kicked'.
  // Explicitly setting bot to null or removing listeners might be needed in complex scenarios,
  // but is often not necessary for basic reconnections.

  // Schedule the creation of a new bot instance after the defined delay.
  setTimeout(createBot, RECONNECT_DELAY);
}

// Handler for general bot errors.
function onError(err) {
  log('error', "Bot error:", err); // Log the error with 'error' level.
  // Critical errors often lead to a disconnection, triggering the 'end' event.
  // More sophisticated error handling might inspect the error type to decide on
  // specific recovery actions, but relying on 'end' for reconnection is common.
}

// Handler for when the bot disconnects from the server.
// This is triggered by various reasons, including kicks and timeouts.
function onEnd(reason) {
  log('warn', "Bot disconnected. Reason:", reason); // Log the disconnection reason as a warning.
  log('info', `Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds...`); // Inform about the reconnection attempt.

  // Clean up any ongoing activities before attempting to reconnect.
  stopWandering(); // Stop any random wandering movement.
    if (bot && bot.pathfinder) { // Ensure bot and pathfinder exist before stopping
      bot.pathfinder.stop(); // Stop any pathfinding in progress.
  }
  // Note: Similar to 'kicked', Mineflayer handles much of the cleanup.

  // Schedule the creation of a new bot instance after the defined delay.
  setTimeout(createBot, RECONNECT_DELAY);
}

// --- Behavior Loops ---

// This loop periodically triggers a simple random movement for the bot when it's idle.
function startWanderingLoop() {
    // Set up an interval that runs every WANDER_INTERVAL milliseconds.
    setInterval(async () => {
        // Only perform random movement if bot is ready, has a pathfinder, is not currently pathfinding,
        // and is not already in the process of a wandering movement.
        if (!bot || !bot.pathfinder || bot.pathfinder.isMoving() || isWandering) {
            return; // If any condition is not met, skip this iteration.
        }

        isWandering = true; // Set state to indicate wandering movement is in progress.
        // log('debug', 'Starting random wander movement.'); // Debug log removed

        try {
            // Pick a random direction to move in
            const directions = ['forward', 'back', 'left', 'right'];
            const randomDirection = directions[Math.floor(Math.random() * directions.length)];

            // Start moving in the random direction
            bot.setControlState(randomDirection, true);

            // Optionally add a random jump with a 50% chance.
            if (Math.random() > 0.5) { // 50% chance to jump
                 bot.setControlState('jump', true);
            }

            // Wait for the duration of the random movement before stopping.
            await bot.waitForTicks(RANDOM_MOVE_TICKS);
            // log('debug', 'Random wander movement completed.'); // Debug log removed

        } catch (err) {
            // Catch and log any unexpected errors that occur during the random movement execution.
            log('error', "Random movement failed:", err.message);
        } finally {
            // This block always executes after the try/catch, ensuring controls are reset.
            // Ensure all movement control states are turned off after the movement attempt,
            // regardless of whether it completed successfully or errored.
            if (bot) { // Check if bot instance still exists
                bot.setControlState('forward', false);
                bot.setControlState('back', false);
                bot.setControlState('left', false);
                bot.setControlState('right', false);
                bot.setControlState('jump', false);
            }
            isWandering = false; // Reset the wandering state to false.
        }
    }, WANDER_INTERVAL); // The interval time for the loop.
}

// Helper function to stop the current random wandering movement.
function stopWandering() {
    if (isWandering) { // Check if the bot is currently in a wandering movement.
        isWandering = false; // Set the state to false.
        log('info', 'Stopping wandering movement.'); // Log the action.
        // Ensure all movement control states are reset when stopping the wandering movement.
        if (bot) { // Check if bot instance still exists
            bot.setControlState('forward', false);
            bot.setControlState('back', false);
            bot.setControlState('left', false);
            bot.setControlState('right', false);
            bot.setControlState('jump', false);
        }
    }
     // Also ensure the pathfinder is stopped if it was somehow active,
     // which could happen if a command or other logic initiated pathfinding.
    if (bot && bot.pathfinder && bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
        log('info', 'Pathfinder stopped.'); // Log pathfinder stop.
    }
}

// This loop periodically checks for very close players and triggers a jump.
function startClosePlayerJumpLoop() {
    // Set up an interval that runs every JUMP_CHECK_INTERVAL milliseconds.
    setInterval(() => {
        // Only check for jumping if the bot is ready, has an entity, has a pathfinder,
        // and is not currently using the pathfinder for navigation (simple movement is okay).
        if (!bot || !bot.entity || (bot && bot.pathfinder && bot.pathfinder.isMoving())) {
            return; // If any condition is not met, skip this iteration.
        }

        // Find players within the defined close jump radius.
        const veryClosePlayers = Object.values(bot.players).filter(p =>
            p.entity && // Ensure the player object has an associated entity
            p.username !== bot.username && // Exclude the bot itself from the check
            bot.entity.position.distanceTo(p.entity.position) <= CLOSE_PLAYER_JUMP_RADIUS // Check if the player's entity is within the jump radius
        );

        // If very close players are found:
        if (veryClosePlayers.length > 0) {
            // Make the bot jump, but only if it's not already in the process of jumping.
            if (bot && !bot.controlState.jump) { // Check if bot exists and jump control is off
                 // log('debug', 'Player close, attempting to jump.'); // Debug log removed
                bot.setControlState('jump', true); // Set the jump control state to true.
                // Use a short timeout to turn off the jump control, simulating a brief key press.
                setTimeout(() => {
                    if (bot) { // Check if bot exists before turning off control
                        bot.setControlState('jump', false); // Turn off the jump control state.
                         // log('debug', 'Jump control released.'); // Debug log removed
                    }
                }, 100); // Timeout duration: 100 milliseconds.
            }
        } else {
            // If no very close players, ensure the jump control is off.
             // Only turn off if the jump control is currently on.
            if (bot && bot.controlState.jump) { // Check if bot exists and jump control is on
                bot.setControlState('jump', false); // Turn off the jump control state.
                 // log('debug', 'No close players, jump control released.'); // Debug log removed
            }
        }

    }, JUMP_CHECK_INTERVAL); // The interval time for the loop.
}


// --- Console Input Handling ---
// Set up a readline interface to read input from the console.
const rl = readline.createInterface({
  input: process.stdin, // Read from standard input (keyboard)
  output: process.stdout, // Output to standard output (console)
});

// Handle each line of input received from the console.
rl.on("line", (input) => {
  // Ensure the bot is ready and connected before attempting to send messages.
  if (!bot || !bot.chat) { // Check if bot and its chat function are available
    log('warn', "Bot not ready to send message."); // Inform the user if the bot is not ready.
    return; // Exit the handler if the bot is not ready.
  }

  // Check if the input starts with ".cmd ", indicating a server command.
  if (input.startsWith(".cmd ")) {
    const command = input.slice(5); // Extract the command string after ".cmd ".
    // Send the command to the server using bot.chat, prefixed with '/'. Add error handling.
    bot.chat(`/${command}`).catch(err => log('error', 'Failed to send command chat:', err.message));
    log('info', `Executed command: /${command}`); // Log the executed command in the console.
  } else {
    // If the input does not start with ".cmd ", send it directly as a chat message. Add error handling.
    bot.chat(input).catch(err => log('error', 'Failed to send chat message:', err.message));
  }
});

// --- Start the Bot ---
createBot(); // Call the function to create and start the bot when the script runs.
