const express = require("express");
const http = require("http");
const mineflayer = require('mineflayer');
const pvp = require('mineflayer-pvp').plugin;
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const armorManager = require('mineflayer-armor-manager');
const AutoAuth = require('mineflayer-auto-auth');
const app = express();

app.use(express.json());

app.get("/", (_, res) => res.sendFile(__dirname + "/index.html"));
app.listen(process.env.PORT);

setInterval(() => {
  http.get(`http://${process.env.PROJECT_DOMAIN}.repl.co/`);
}, 224000);

// YOU CAN ONLY EDIT THIS SECTION!!
function createBot () {
  const bot = mineflayer.createBot({
    host: 'billismp.falixsrv.me',
    port: 13246,
    username: 'sanx',
    version: false, // e.g. '1.16.5' if needed
    plugins: [AutoAuth],
    AutoAuth: 'sanx'
  });

  bot.loadPlugin(pvp);
  bot.loadPlugin(armorManager);
  bot.loadPlugin(pathfinder);

  // Equip sword
  bot.on('playerCollect', (collector, itemDrop) => {
    if (collector !== bot.entity) return;
    setTimeout(() => {
      const sword = bot.inventory.items().find(item => item.name.includes('sword'));
      if (sword) bot.equip(sword, 'hand');
    }, 150);
  });

  // Equip shield
  bot.on('playerCollect', (collector, itemDrop) => {
    if (collector !== bot.entity) return;
    setTimeout(() => {
      const shield = bot.inventory.items().find(item => item.name.includes('shield'));
      if (shield) bot.equip(shield, 'off-hand');
    }, 250);
  });

  let guardPos = null;
  let patrolling = true;
  let pointA = null;
  let pointB = null;
  let goingToA = false;

  function guardArea (pos) {
    stopPatrol(); // Stop patrolling when guarding
    guardPos = pos.clone();
    if (!bot.pvp.target) moveToGuardPos();
  }

  function stopGuarding () {
    guardPos = null;
    bot.pvp.stop();
    bot.pathfinder.setGoal(null);
    startPatrol(pointA, pointB); // Resume patrol
  }

  function moveToGuardPos () {
    const mcData = require('minecraft-data')(bot.version);
    bot.pathfinder.setMovements(new Movements(bot, mcData));
    bot.pathfinder.setGoal(new goals.GoalBlock(guardPos.x, guardPos.y, guardPos.z));
  }

  function startPatrol(pos1, pos2) {
    if (!pos1 || !pos2) return;
    pointA = pos1.clone();
    pointB = pos2.clone();
    patrolling = true;
    patrol();
  }

  function stopPatrol() {
    patrolling = false;
    bot.pathfinder.setGoal(null);
  }

  function patrol() {
    if (!patrolling || !pointA || !pointB) return;
    const destination = goingToA ? pointA : pointB;
    goingToA = !goingToA;

    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.setGoal(new goals.GoalBlock(destination.x, destination.y, destination.z));

    const checkArrival = setInterval(() => {
      if (!bot.pathfinder.isMoving()) {
        clearInterval(checkArrival);
        setTimeout(() => {
          if (patrolling) patrol();
        }, 1000);
      }
    }, 500);
  }

  bot.on('stoppedAttacking', () => {
    if (guardPos) moveToGuardPos();
  });

  bot.on('physicTick', () => {
    if (bot.pvp.target || bot.pathfinder.isMoving()) return;

    const entity = bot.nearestEntity();
    if (entity) bot.lookAt(entity.position.offset(0, entity.height, 0));
  });

  bot.on('physicTick', () => {
    if (!guardPos) return;
    const filter = e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 16 &&
                        e.mobType !== 'Armor Stand';
    const entity = bot.nearestEntity(filter);
    if (entity) bot.pvp.attack(entity);
  });

  bot.on('chat', (username, message) => {
    const player = bot.players[username]?.entity;
    if (!player) return;

    if (message === 'guard') {
      bot.chat('I will!');
      guardArea(player.position);
    }

    if (message === 'stop') {
      bot.chat('I will stop!');
      stopGuarding();
    }

    if (message === 'follow me') {
      stopPatrol();
      const mcData = require('minecraft-data')(bot.version);
      const movements = new Movements(bot, mcData);
      bot.pathfinder.setMovements(movements);
      bot.chat("Following you!");
      bot.pathfinder.setGoal(new goals.GoalFollow(player, 1), true);
    }

    if (message === 'stay') {
      stopPatrol();
      bot.chat("Okay, I'll stay here.");
      bot.pathfinder.setGoal(null);
    }
  });

  bot.once('spawn', () => {
    const pos1 = bot.entity.position.offset(3, 0, 0);
    const pos2 = bot.entity.position.offset(-3, 0, 0);
    startPatrol(pos1, pos2);
  });

  bot.on('kicked', console.log);
  bot.on('error', console.log);
  bot.on('end', createBot);
}

createBot();
