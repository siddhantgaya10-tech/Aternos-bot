import pf from 'mineflayer-pathfinder';
import cb from 'mineflayer-collectblock';
import pvp from 'mineflayer-pvp';
const { pathfinder, Movements, goals } = pf;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hostile = e => e && (e.type === 'hostile' || e.kind === 'Hostile mobs');

export function setup(bot, r) {
  bot.loadPlugin(pathfinder); bot.loadPlugin(cb.plugin || cb); bot.loadPlugin(pvp.plugin || pvp);
  bot.once('spawn', () => bot.pathfinder.setMovements(new Movements(bot)));
  let task = 0, eating = false, lastKey = '', lastAt = 0;
  const say = m => { bot.chat(String(m).slice(0, 250)); r.log('bot: ' + m); };
  const ownerName = () => (r.cfg.owner || '').toLowerCase();
  const ownerEnt = () => { const k = Object.keys(bot.players).find(n => n.toLowerCase() === ownerName()); return k && bot.players[k].entity; };
  const stop = () => {
    task++; r.busy = false;
    try { bot.collectBlock.cancelTask(() => {}); } catch {}
    try { bot.pathfinder.setGoal(null); bot.pvp.stop(); bot.clearControlStates(); bot.stopDigging(); } catch {}
  };
  const run = async fn => {
    stop(); const id = task; r.busy = true;
    try { await fn(() => id !== task); } catch (e) { if (id === task) say('Failed: ' + String(e.message).slice(0, 90)); }
    if (id === task) r.busy = false;
  };
  const ids = names => names.map(n => bot.registry.blocksByName[n]?.id).filter(x => x !== undefined);
  const mineIds = n => { n = n.toLowerCase().replace(/ /g, '_'); return ids([n, n + '_ore', 'deepslate_' + n + '_ore']); };
  const logIds = () => Object.values(bot.registry.blocksByName).filter(b => /_(log|stem)$/.test(b.name) && !b.name.startsWith('stripped')).map(b => b.id);
  const gather = (c, matching, n, label) => async () => {
    let got = 0;
    while (got < n && !c()) {
      const pos = bot.findBlocks({ matching, maxDistance: 48, count: Math.min(n - got, 8) });
      if (!pos.length) { say(`No more ${label} nearby. Got ${got}.`); return; }
      await bot.collectBlock.collect(pos.map(p => bot.blockAt(p))); got += pos.length;
    }
    if (!c()) say(`Done: collected ${got} ${label}.`);
  };
  const find = (n) => bot.inventory.items().find(i => i.name.includes(n.toLowerCase().replace(/ /g, '_')));

  const cmds = {
    help: () => say('!come !follow !stop !goto x y z !mine <block> [n] !chop [n] !collect !attack [name] !guard !drop|give <item> [n] !equip <item> !inv !sleep !pos !say <msg> !jump'),
    come: () => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); await bot.pathfinder.goto(new goals.GoalNear(o.position.x, o.position.y, o.position.z, 2)); }),
    follow: () => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); say('Following you.'); bot.pathfinder.setGoal(new goals.GoalFollow(o, 2), true); while (!c()) await sleep(1000); }),
    stop: () => { stop(); say('Stopped.'); },
    goto: a => run(async c => { const [x, y, z] = a.map(Number); if ([x, y, z].some(isNaN)) return say('Use: !goto x y z'); await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)); say('Arrived.'); }),
    mine: a => run(async c => { const n = parseInt(a[a.length - 1]) || 1, name = a.filter(x => isNaN(x)).join('_'); const m = mineIds(name); if (!m.length) return say('Unknown block: ' + name); say(`Mining ${n} ${name}`); await gather(c, m, n, name)(); }),
    chop: a => run(async c => { const n = parseInt(a[0]) || 10; say(`Chopping ${n} logs`); await gather(c, logIds(), n, 'logs')(); }),
    collect: () => run(async c => {
      const items = Object.values(bot.entities).filter(e => (e.name === 'item' || e.displayName === 'Item') && bot.entity.position.distanceTo(e.position) < 32);
      for (const e of items) { if (c()) return; await bot.pathfinder.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 0)).catch(() => {}); }
      say(`Picked up ${items.length} drops.`);
    }),
    attack: a => run(async c => {
      const t = a[0] ? Object.values(bot.players).find(p => p.username.toLowerCase() === a[0].toLowerCase())?.entity : bot.nearestEntity(hostile);
      if (!t) return say('Nothing to attack.'); bot.pvp.attack(t); while (!c() && bot.entities[t.id]) await sleep(500); bot.pvp.stop();
    }),
    guard: () => run(async c => { say('Guarding this spot.'); while (!c()) { const m = bot.nearestEntity(e => hostile(e) && e.position.distanceTo(bot.entity.position) < 16); if (m && !bot.pvp.target) bot.pvp.attack(m); await sleep(800); } }),
    drop: a => run(async () => { const n = parseInt(a[a.length - 1]); const it = find(a.filter(x => isNaN(x)).join('_')); if (!it) return say("I don't have that."); await bot.toss(it.type, null, isNaN(n) ? it.count : n); }),
    give: a => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); const n = parseInt(a[a.length - 1]); const it = find(a.filter(x => isNaN(x)).join('_')); if (!it) return say("I don't have that."); await bot.pathfinder.goto(new goals.GoalNear(o.position.x, o.position.y, o.position.z, 2)); await bot.lookAt(o.position.offset(0, 1.6, 0)); await bot.toss(it.type, null, isNaN(n) ? it.count : n); }),
    equip: a => run(async () => { const it = find(a.join('_')); if (!it) return say("I don't have that."); await bot.equip(it, 'hand'); }),
    inv: () => say(bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ').slice(0, 240) || 'Empty.'),
    sleep: () => run(async () => { const bed = bot.findBlock({ matching: b => b.name.endsWith('_bed'), maxDistance: 32 }); if (!bed) return say('No bed nearby.'); await bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1)); await bot.sleep(bed); }),
    pos: () => { const p = bot.entity.position; say(`${p.x | 0} ${p.y | 0} ${p.z | 0}  HP ${Math.round(bot.health)} Food ${bot.food}`); },
    say: a => bot.chat(a.join(' ').slice(0, 250)),
    jump: () => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 300); },
  };

  function handle(user, msg) {
    if (!ownerName() || user.toLowerCase() !== ownerName() || !msg.startsWith('!')) return;
    const key = user + msg, now = Date.now(); if (key === lastKey && now - lastAt < 800) return; lastKey = key; lastAt = now;
    const [cmd, ...args] = msg.slice(1).trim().split(/\s+/); const f = cmds[cmd.toLowerCase()];
    r.log(`owner: ${msg}`); if (!f) return say('Unknown command. Try !help'); Promise.resolve(f(args)).catch(e => say('Error: ' + e.message));
  }
  bot.on('chat', handle); bot.on('whisper', handle);
  bot.on('messagestr', m => { const x = m.match(/^(?:\[[^\]]*\]\s*)*<?(\w{3,16})>?[:»>]?\s+(!.+)$/); if (x) handle(x[1], x[2]); });

  // eat when hungry
  bot.on('health', async () => {
    if (eating || bot.food > 14) return; const f = bot.inventory.items().find(i => bot.registry.foodsByName[i.name]); if (!f) return;
    eating = true; try { await bot.equip(f, 'hand'); await bot.consume(); } catch {} eating = false;
  });
}
