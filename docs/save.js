'use strict';
(function (root) {
  const AR = root.AR = root.AR || {};
  const SAVE_KEY = 'abyss-racer-save';
  const VERSION = 2;
  const MAX_COUNTER = 1e12;
  const MAX_PEARLS = 1e9;
  const MAX_XP = 1e9;
  const STARTER_STAGE = 'reef';
  const STARTER_VEHICLE = 'rover';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const number = (value, max = MAX_COUNTER) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
  const integer = (value, max = MAX_COUNTER) => Math.floor(number(value, max));
  const definitions = key => Array.isArray(AR[key]) ? AR[key] : [];
  const stageIds = () => definitions('STAGES').map(stage => stage.id);
  const vehicleIds = () => definitions('VEHICLES').map(vehicle => vehicle.id);
  const uniqueIds = (value, allowed, starter) => Array.from(new Set([starter].concat(Array.isArray(value) ? value.filter(id => allowed.includes(id)) : [])));
  const maximumDistance = data => Math.max(0, ...Object.values(data.bests));
  const stageDistance = (data, id) => Math.max(0, ...Object.keys(data.bests).filter(key => key.startsWith(id + ':')).map(key => data.bests[key]));

  AR.xpForLevel = level => {
    const completed = Math.max(0, Math.floor(Number.isFinite(level) ? level : 1) - 1);
    return 200 * completed + 75 * completed * completed;
  };
  const levelForXP = xp => 1 + Math.floor((-200 + Math.sqrt(40000 + 300 * xp)) / 150);

  AR.COSMETICS = [
    { id: 'aqua', name: 'Lagoon beam', level: 1, kind: 'headlight', color: '#90fff1' },
    { id: 'amber', name: 'Sunken gold', level: 2, kind: 'headlight', color: '#ffd37a' },
    { id: 'violet', name: 'Ultraviolet', level: 3, kind: 'headlight', color: '#bd9cff' },
    { id: 'rose', name: 'Coral glow', level: 5, kind: 'headlight', color: '#ff9cb5' },
    { id: 'emerald', name: 'Bioluminescence', level: 7, kind: 'headlight', color: '#a7ff9e' },
    { id: 'ice', name: 'Polar light', level: 10, kind: 'headlight', color: '#edfbff' },
    { id: 'bubbles', name: 'Bubble trail', level: 1, kind: 'trail' },
    { id: 'sparkles', name: 'Pearl dust', level: 4, kind: 'trail', color: '#ffdd97' },
    { id: 'plankton', name: 'Living stars', level: 8, kind: 'trail', color: '#9effcd' }
  ];

  AR.ACHIEVEMENTS = [
    { id: 'first-dive', name: 'First dive', description: 'Finish your first expedition.', reward: 50, test: d => d.totalRuns >= 1 },
    { id: 'first-100', name: 'Finding your fins', description: 'Travel 100 m in one run.', reward: 50, test: d => maximumDistance(d) >= 100 },
    { id: 'first-500', name: 'First 500 m', description: 'Travel 500 m in one run.', reward: 150, test: d => maximumDistance(d) >= 500 },
    { id: 'first-1000', name: 'Ocean explorer', description: 'Travel 1,000 m in one run.', reward: 300, test: d => maximumDistance(d) >= 1000 },
    { id: 'first-2500', name: 'Beyond the horizon', description: 'Travel 2,500 m in one run.', reward: 600, test: d => maximumDistance(d) >= 2500 },
    { id: 'first-flip', name: 'Head over heels', description: 'Complete your first flip.', reward: 100, test: d => d.totals.flips >= 1 },
    { id: 'triple-backflip', name: 'Triple backflip', description: 'Complete three backflips in a single jump.', reward: 500, test: d => d.totals.maxFlips >= 3 },
    { id: 'chest-hunter', name: 'Chest hunter', description: 'Open 10 treasure chests.', reward: 250, test: d => d.totals.chests >= 10 },
    { id: 'golden-touch', name: 'Golden touch', description: 'Collect five golden pearls.', reward: 200, test: d => d.totals.golden >= 5 },
    { id: 'pearl-diver', name: 'Pearl diver', description: 'Earn 5,000 pearls from expeditions.', reward: 300, test: d => d.totals.pearls >= 5000 },
    { id: 'hang-time', name: 'Weightless', description: 'Spend a total of 120 seconds airborne.', reward: 250, test: d => d.totals.airtime >= 120 },
    { id: 'ballast-master', name: 'Against the current', description: 'Fire 50 ballast bursts.', reward: 200, test: d => d.totals.bursts >= 50 },
    { id: 'ice-cold', name: 'Ice cold', description: 'Travel 1,000 m on Ice Shelf.', reward: 400, test: d => stageDistance(d, 'ice') >= 1000 },
    { id: 'abyss-walker', name: 'Into the black', description: 'Travel 500 m in Abyssal Trench.', reward: 350, test: d => stageDistance(d, 'abyss') >= 500 },
    { id: 'fleet', name: 'A full fleet', description: 'Own all five vehicles.', reward: 500, test: d => d.vehicles.length >= 5 },
    { id: 'cartographer', name: 'Cartographer', description: 'Unlock all six stages.', reward: 500, test: d => d.stages.length >= 6 },
    { id: 'veteran', name: 'Seasoned submariner', description: 'Finish 50 expeditions.', reward: 500, test: d => d.totalRuns >= 50 },
    { id: 'deep-odometer', name: 'Long way from home', description: 'Travel 25 km in total.', reward: 500, test: d => d.totalDistance >= 25000 }
  ];

  function clean(raw) {
    // Only known fields enter the new object. Never merge untrusted save objects.
    const source = record(raw) ? raw : {};
    const stages = stageIds();
    const vehicles = vehicleIds();
    const data = {
      version: VERSION,
      pearls: integer(source.pearls, MAX_PEARLS),
      stages: uniqueIds(source.stages, stages, STARTER_STAGE),
      vehicles: uniqueIds(source.vehicles, vehicles, STARTER_VEHICLE),
      selectedStage: STARTER_STAGE,
      selectedVehicle: STARTER_VEHICLE,
      upgrades: {}, bests: {},
      totalRuns: integer(source.totalRuns),
      totalDistance: number(source.totalDistance),
      xp: integer(source.xp, MAX_XP), level: 1, achievements: [],
      totals: { pearls: 0, chests: 0, golden: 0, flips: 0, airtime: 0, bursts: 0, maxFlips: 0 },
      settings: { muted: false, headlight: 'aqua', trail: 'bubbles' }
    };
    if (data.stages.includes(source.selectedStage)) data.selectedStage = source.selectedStage;
    if (data.vehicles.includes(source.selectedVehicle)) data.selectedVehicle = source.selectedVehicle;
    const savedUpgrades = record(source.upgrades) ? source.upgrades : {};
    for (const vehicleId of vehicles) {
      data.upgrades[vehicleId] = {};
      const levels = own(savedUpgrades, vehicleId) && record(savedUpgrades[vehicleId]) ? savedUpgrades[vehicleId] : {};
      for (const upgrade of definitions('UPGRADES')) data.upgrades[vehicleId][upgrade.id] = integer(levels[upgrade.id], upgrade.maxLevel || 12);
    }
    const bests = record(source.bests) ? source.bests : {};
    for (const stageId of stages) for (const vehicleId of vehicles) {
      const key = stageId + ':' + vehicleId;
      if (own(bests, key)) data.bests[key] = number(bests[key]);
    }
    data.level = levelForXP(data.xp);
    if (Array.isArray(source.achievements)) data.achievements = Array.from(new Set(source.achievements.filter(id => AR.ACHIEVEMENTS.some(achievement => achievement.id === id))));
    if (record(source.totals)) for (const key of Object.keys(data.totals)) data.totals[key] = number(source.totals[key]);
    if (record(source.settings)) {
      data.settings.muted = source.settings.muted === true;
      for (const kind of ['headlight', 'trail']) {
        const cosmetic = AR.COSMETICS.find(item => item.kind === kind && item.id === source.settings[kind] && item.level <= data.level);
        if (cosmetic) data.settings[kind] = cosmetic.id;
      }
    }
    return data;
  }

  function migrate(raw) {
    if (!record(raw) || (raw.version !== undefined && raw.version !== 1 && raw.version !== VERSION)) return {};
    if (raw.version === VERSION) return raw;
    // v1 used unlocked* lists and stage-wide bests; preserve these as starter records.
    const migrated = Object.assign(Object.create(null), raw);
    if (!Array.isArray(migrated.stages)) migrated.stages = raw.unlockedStages;
    if (!Array.isArray(migrated.vehicles)) migrated.vehicles = raw.unlockedVehicles;
    if (migrated.pearls === undefined) migrated.pearls = raw.coins;
    if (migrated.xp === undefined) migrated.xp = raw.experience;
    migrated.bests = {};
    const oldBests = record(raw.bests) ? raw.bests : record(raw.bestDistances) ? raw.bestDistances : {};
    for (const key of Object.keys(oldBests)) {
      if (key.includes(':')) migrated.bests[key] = oldBests[key];
      else if (stageIds().includes(key)) migrated.bests[key + ':rover'] = oldBests[key];
    }
    if (!record(migrated.settings)) migrated.settings = { muted: raw.muted === true };
    return migrated;
  }

  class Save {
    constructor() {
      this.storageAvailable = true;
      let raw = null;
      try {
        const storage = root.localStorage;
        if (storage) {
          for (const key of [SAVE_KEY, 'abyss-racer', 'abyssRacerSave']) {
            const text = storage.getItem(key);
            if (!text) continue;
            try { raw = JSON.parse(text); } catch (_) { raw = null; }
            break;
          }
        } else this.storageAvailable = false;
      } catch (_) { this.storageAvailable = false; }
      this.data = clean(migrate(raw));
    }

    save() {
      try {
        if (!root.localStorage) { this.storageAvailable = false; return false; }
        root.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
        this.storageAvailable = true;
        return true;
      } catch (_) { this.storageAvailable = false; return false; }
    }

    reset() {
      this.data = clean({});
      // Remove the previous save before writing defaults, so a failed write cannot restore old progress.
      try {
        if (root.localStorage) for (const key of [SAVE_KEY, 'abyss-racer', 'abyssRacerSave']) root.localStorage.removeItem(key);
      } catch (_) { /* The in-memory reset remains usable when storage is blocked. */ }
      this.save();
      return this.data;
    }

    buyStage(id) {
      return this.buyUnlock(id, definitions('STAGES'), 'stages', 'selectedStage');
    }

    buyVehicle(id) {
      return this.buyUnlock(id, definitions('VEHICLES'), 'vehicles', 'selectedVehicle');
    }

    buyUnlock(id, options, collection, selection) {
      const item = options.find(entry => entry.id === id);
      if (!item || this.data[collection].includes(id) || this.data.pearls < item.cost) return false;
      this.data.pearls -= item.cost;
      this.data[collection].push(id);
      this.data[selection] = id;
      this.checkAchievements();
      this.save();
      return true;
    }

    buyUpgrade(id) {
      const upgrade = definitions('UPGRADES').find(item => item.id === id);
      const vehicleId = this.data.selectedVehicle;
      if (!upgrade || !this.data.vehicles.includes(vehicleId)) return false;
      const levels = this.data.upgrades[vehicleId];
      const current = integer(levels[id], upgrade.maxLevel || 12);
      if (current >= (upgrade.maxLevel || 12)) return false;
      const cost = AR.upgradeCost(id, current);
      if (!Number.isFinite(cost) || cost < 0 || this.data.pearls < cost) return false;
      this.data.pearls -= cost;
      levels[id] = current + 1;
      this.save();
      return true;
    }

    checkAchievements() {
      const newlyEarned = [];
      for (const achievement of AR.ACHIEVEMENTS) {
        if (this.data.achievements.includes(achievement.id) || !achievement.test(this.data)) continue;
        this.data.achievements.push(achievement.id);
        this.data.pearls = Math.min(MAX_PEARLS, this.data.pearls + achievement.reward);
        newlyEarned.push(achievement);
      }
      return newlyEarned;
    }

    finishRun(summary) {
      const run = record(summary) ? summary : {};
      const data = this.data;
      const distance = number(run.distance);
      const pearls = integer(run.pearls, MAX_PEARLS);
      const stageId = stageIds().includes(run.stageId) ? run.stageId : data.selectedStage;
      const vehicleId = vehicleIds().includes(run.vehicleId) ? run.vehicleId : data.selectedVehicle;
      const bestKey = stageId + ':' + vehicleId;
      const isBest = distance > (data.bests[bestKey] || 0);
      data.bests[bestKey] = Math.max(data.bests[bestKey] || 0, distance);
      data.totalRuns = Math.min(MAX_COUNTER, data.totalRuns + 1);
      data.totalDistance = Math.min(MAX_COUNTER, data.totalDistance + distance);
      data.pearls = Math.min(MAX_PEARLS, data.pearls + pearls);
      data.totals.pearls = Math.min(MAX_COUNTER, data.totals.pearls + pearls);
      for (const key of ['flips', 'airtime', 'chests', 'golden', 'bursts']) data.totals[key] = Math.min(MAX_COUNTER, data.totals[key] + number(run[key]));
      data.totals.maxFlips = Math.max(data.totals.maxFlips, integer(run.maxFlips));
      const previousXP = data.xp;
      const previousLevel = data.level;
      const trickXP = run.trickXP === undefined ? integer(run.flips) * 50 : integer(run.trickXP);
      data.xp = Math.min(MAX_XP, data.xp + Math.floor(distance + trickXP + number(run.airtime) * 2));
      data.level = levelForXP(data.xp);
      const levelUps = Math.max(0, data.level - previousLevel);
      const levelBonus = levelUps * 75;
      data.pearls = Math.min(MAX_PEARLS, data.pearls + levelBonus);
      const newAchievements = this.checkAchievements();
      const newCosmetics = AR.COSMETICS.filter(item => item.level > previousLevel && item.level <= data.level);
      // Credit all components before a single write: reloads cannot persist half a reward.
      this.save();
      return { xpGained: data.xp - previousXP, levelUps, newAchievements, newCosmetics, levelBonus, isBest };
    }
  }

  AR.Save = Save;
  AR.SAVE_KEY = SAVE_KEY;
})(typeof globalThis !== 'undefined' ? globalThis : this);
