const express = require("express");
const http = require("http");
const mineflayer = require("mineflayer");
const pvp = require("mineflayer-pvp").plugin;
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const armorManager = require("mineflayer-armor-manager");
const AutoAuth = require("mineflayer-auto-auth");
const readline = require("readline");

const app = express();
app.use(express.json());

app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Web server running.");
});

setInterval(() => {
  if (process.env.PROJECT_DOMAIN) {
    http.get(`http://${process.env.PROJECT_DOMAIN}.repl.co/`);
  }
}, 224000);

let bot;

function createBot() {
  bot = mineflayer.createBot({
    host: "billismp.falixsrv.me",
    port: 13246,
    username: "sanx",
    version: false,
    plugins: [AutoAuth],
    AutoAuth: "sanx",
  });

  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(pathfinder);

  let mcData;
  let defaultMove;
  let isHarvesting = false;

  bot.once("spawn", () => {
    mcData = require("minecraft-data")(bot.version);
    defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);
    startHarvestingCrops();
  });

  function startHarvestingCrops() {
    setInterval(() => {
      if (isHarvesting || bot.inventory.full) return;

      const crops = findHarvestableCrops();
      if (crops.length > 0) {
        const block = bot.blockAt(crops[0]);
        if (block && block.position) {
          if (bot.entity.position.distanceTo(block.position) <= 3) {
            isHarvesting = true;
            bot.lookAt(block.position.offset(0.5, 0.5, 0.5), false)
              .then(() => {
                bot.activateBlock(block);
                setTimeout(() => storeItemsInChest(), 1000);
              })
              .catch(err => console.log("Look error:", err))
              .finally(() => isHarvesting = false);
          } else {
            bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z));
          }
        }
      }
    }, 5000);
  }

  function findHarvestableCrops() {
    const blocks = bot.findBlocks({
      matching: [mcData.blocksByName.wheat.id, mcData.blocksByName.carrots.id, mcData.blocksByName.potatoes.id],
      maxDistance: 10,
      count: 10,
    });

    return blocks.filter(block => {
      const b = bot.blockAt(block);
      return b && b.metadata === 7;
    });
  }

  function storeItemsInChest() {
    const chest = findNearestChest();
    if (chest) {
      bot.pathfinder.goto(new goals.GoalBlock(chest.position.x, chest.position.y, chest.position.z)).then(() => {
        bot.openChest(chest).then(chestWindow => {
          bot.inventory.items().forEach(item => {
            chestWindow.deposit(item.type, null, item.count, err => {
              if (err) console.log("Deposit error:", err);
            });
          });
        }).catch(err => ());
      }).catch(err => ());
    }
  }

  function findNearestChest() {
    const chests = bot.findBlocks({
      matching: mcData.blocksByName.chest.id,
      maxDistance: 10,
      count: 1,
    });

    return chests.length > 0 ? bot.blockAt(chests[0]) : null;
  }

  // Log chat messages
  bot.on("chat", (username, message) => {
    if (username !== bot.username) {
      console.log(`[${username}] ${message}`);
    }
  });

  // Player collects item
  bot.on("playerCollect", (collector, itemDrop) => {
    if (collector !== bot.entity) return;
    bot.tossStack(itemDrop).catch(() => {});
  });

  bot.on("kicked", reason => {
    console.log("Bot kicked:", reason);
    setTimeout(createBot, 5000);
  });

  bot.on("error", err => console.log("Bot error:", err));
  bot.on("end", () => {
    console.log("Bot disconnected. Reconnecting...");
    setTimeout(createBot, 5000);
  });
}

// Start the bot
createBot();

// Console input to chat and execute commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (input) => {
  if (!bot || !bot.chat) {
    console.log("Bot not ready.");
    return;
  }

  if (input.startsWith(".cmd ")) {
    const command = input.slice(5);
    bot.chat(`/${command}`);
    console.log(`Executed command: /${command}`);
  } else {
    bot.chat(input);
  }
});
