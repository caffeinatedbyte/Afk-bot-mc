const express = require("express");
const http = require("http");
const mineflayer = require("mineflayer");
const pvp = require("mineflayer-pvp").plugin;
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const armorManager = require("mineflayer-armor-manager");
const AutoAuth = require("mineflayer-auto-auth");
const app = express();

app.use(express.json());

// Serve a basic homepage
app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));

// Start express server
app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running.");
});

// Ping self to prevent sleeping on Replit
setInterval(() => {
  if (process.env.PROJECT_DOMAIN) {
    http.get(`http://${process.env.PROJECT_DOMAIN}.repl.co/`);
  }
}, 224000);

// ===========================
// BOT CREATION STARTS HERE!!
// ===========================
function createBot() {
  const bot = mineflayer.createBot({
    host: "billismp.falixsrv.me",
    port: 13246,
    username: "sanx",
    version: false, // Automatically detects version
    plugins: [AutoAuth],
    AutoAuth: "sanx",
  });

  // Load Plugins
  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(pathfinder);

  let mcData;
  let defaultMove;
  let isHarvesting = false; // Track whether the bot is harvesting

  bot.once("spawn", () => {
    mcData = require("minecraft-data")(bot.version);
    defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    // Start automated farming and harvesting when the bot spawns
    startHarvestingCrops();
  });

  // Harvest crops function
  function startHarvestingCrops() {
    setInterval(() => {
      if (isHarvesting) return; // Don't harvest if already in the process of harvesting

      const crops = findHarvestableCrops();
      if (crops.length > 0) {
        const crop = crops[0]; // Pick the first available crop
        const block = bot.blockAt(crop);
        if (block && block.position) {
          console.log("Attempting to harvest crop at:", block.position); // Debug log for block position
          
          // Check if the crop is within harvesting range (3 blocks away max)
          if (bot.entity.position.distanceTo(block.position) <= 3) {
            isHarvesting = true; // Set harvesting flag
            // Ensure the block is valid before attempting to look at it
            bot.lookAt(block.position.offset(0.5, 0.5, 0.5), false)
              .then(() => {
                bot.activateBlock(block); // Harvest the crop
                console.log("Harvested crop at:", block.position); // Log harvest
                setTimeout(() => {
                  storeItemsInChest(); // After harvesting, store items in chest
                }, 1000); // Wait for item to drop before storing
              })
              .catch((err) => {
                console.log("Error looking at the block: " + err);
              })
              .finally(() => {
                isHarvesting = false; // Reset harvesting flag after interaction
              });
          } else {
            console.log("Crop is out of reach, moving closer...");
            bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
          }
        }
      }
    }, 5000); // Check for harvestable crops every 5 seconds
  }

  // Function to find harvestable crops
  function findHarvestableCrops() {
    const blocks = bot.findBlocks({
      matching: [mcData.blocksByName.wheat.id, mcData.blocksByName.carrots.id, mcData.blocksByName.potatoes.id],
      maxDistance: 10, // Search up to 10 blocks away
      count: 10, // Find up to 10 blocks
    });

    console.log("Found blocks:", blocks);  // Debug log

    return blocks.filter((block) => {
      const blockState = bot.blockAt(block);
      if (blockState) {
        console.log(`Block at ${block} has metadata: ${blockState.metadata}`); // Log metadata for debugging
      }
      return blockState && blockState.metadata === 7; // Check if the crop is fully grown (metadata 7)
    });
  }

  // Function to store items in the nearest chest
  function storeItemsInChest() {
    const chest = findNearestChest();
    if (chest) {
      bot.pathfinder.goto(new goals.GoalBlock(chest.position.x, chest.position.y, chest.position.z)).then(() => {
        bot.openChest(chest).then((chestWindow) => {
          // Insert the harvested items into the chest
          bot.inventory.items().forEach((item) => {
            chestWindow.deposit(item.type, null, item.count, (err) => {
              if (err) {
                console.log("Error depositing item: " + err);
              }
            });
          });
        }).catch((err) => {
          console.log("Error opening chest: " + err);
        });
      }).catch((err) => {
        console.log("Error moving to chest: " + err);
      });
    }
  }

  // Find the nearest chest
  function findNearestChest() {
    const chests = bot.findBlocks({
      matching: mcData.blocksByName.chest.id,
      maxDistance: 10, // Search for chests up to 10 blocks away
      count: 1, // Limit to 1 chest
    });

    if (chests.length > 0) {
      return bot.blockAt(chests[0]);
    }
    return null;
  }

  // Ensure that the bot immediately tosses any item it picks up
  bot.on("playerCollect", (collector, itemDrop) => {
    if (collector !== bot.entity) return;
    // Toss the item immediately without saying anything in chat
    bot.tossStack(itemDrop);
  });

  // Reconnect if kicked or disconnected
  bot.on("kicked", (reason) => {
    console.log("Bot kicked: " + reason);
    setTimeout(createBot, 5000); // Reconnect after 5 seconds
  });
  bot.on("error", (err) => {
    console.log("Bot error: " + err);
  });
  bot.on("end", () => {
    console.log("Bot disconnected. Reconnecting...");
    setTimeout(createBot, 5000); // Reconnect after 5 seconds
  });
}

// Start bot
createBot();
