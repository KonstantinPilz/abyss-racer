(function (root) {
  'use strict';
  const AR = root.AR = root.AR || {};
  AR.VERSION = '3.3.0';
  AR.FIXED_DT = 1 / 120;
  AR.METRES_PER_PIXEL = 0.1;
  AR.STAGES = [
    { id: 'reef', name: 'Coral Reef', cost: 0, description: 'Sunlit coral gardens. Gentle hills and forgiving sand.', depth: 45, seed: 4127, gravity: 235, friction: 1.05, amplitude: 42, frequency: 1, ramps: 0.65, rockiness: 0.1, palette: { top: '#06465b', bottom: '#082634', sand: '#80c9ab', ground: '#163e45', accent: '#ffb866' } },
    { id: 'kelp', name: 'Kelp Forest', cost: 900, description: 'Towering kelp, broad swells, and winding gullies.', depth: 120, seed: 9103, gravity: 225, friction: 1.1, amplitude: 76, frequency: 0.9, ramps: 0.8, rockiness: 0.25, palette: { top: '#123e39', bottom: '#071f26', sand: '#9dc48c', ground: '#243e36', accent: '#b9da76' } },
    { id: 'wreck', name: 'Shipwreck Graveyard', cost: 2300, description: 'Broken hulls and abrupt ramps across a haunted seabed.', depth: 260, seed: 7817, gravity: 245, friction: 1, amplitude: 82, frequency: 1.3, ramps: 1.25, rockiness: 0.5, palette: { top: '#183745', bottom: '#091823', sand: '#9cab9c', ground: '#303b40', accent: '#e7b88a' } },
    { id: 'volcanic', name: 'Volcanic Vents', cost: 4200, description: 'Volcanic ridges. Heat vents launch your rover upward.', depth: 670, seed: 6089, gravity: 250, friction: 1.15, amplitude: 106, frequency: 1.2, ramps: 1.05, rockiness: 0.55, palette: { top: '#342531', bottom: '#180f20', sand: '#d17966', ground: '#392b38', accent: '#ff7654' } },
    { id: 'ice', name: 'Ice Shelf', cost: 6500, description: 'Slippery ice beneath a low, jagged frozen ceiling.', depth: 180, seed: 3361, gravity: 230, friction: 0.29, amplitude: 66, frequency: 1.05, ramps: 0.95, rockiness: 0.18, palette: { top: '#17465a', bottom: '#102b43', sand: '#a6e7ed', ground: '#2c5770', accent: '#a4eaff' } },
    { id: 'abyss', name: 'Abyssal Trench', cost: 9500, description: 'Black water, steep trenches, and the glow of anglerfish.', depth: 2840, seed: 9931, gravity: 210, friction: 0.95, amplitude: 130, frequency: 0.85, ramps: 1.35, rockiness: 0.45, palette: { top: '#030814', bottom: '#020710', sand: '#41536d', ground: '#121e35', accent: '#a991ff' } },
    { id: 'city', name: 'Sunken City', cost: 7400, description: 'Atlantis in turquoise and gold. Ruined arches frame a city slowly returning to the sea.', how: 'Cross cracked bridges before they crumble; read the current arrows.', depth: 420, seed: 5279, gravity: 240, friction: 1.05, amplitude: 48, frequency: .85, ramps: .7, rockiness: .08, palette: { top: '#09474e', bottom: '#102d3b', sand: '#bcbd8e', ground: '#304650', accent: '#ffd18a' } },
    { id: 'whale', name: 'Whale Fall', cost: 8600, description: 'An immense ivory skeleton shelters a violet garden of living stars.', how: 'Ease over bone ramps, duck under ribs, and breathe in glowing plankton.', depth: 1100, seed: 7133, gravity: 230, friction: 1.05, amplitude: 44, frequency: .9, ramps: .85, rockiness: .06, palette: { top: '#202746', bottom: '#101b32', sand: '#cec7b3', ground: '#33394a', accent: '#98ffe0' } },
    { id: 'thermal', name: 'Thermal Springs', cost: 11000, description: 'Amber haze over a restless geyser field. The seabed itself takes a breath.', how: 'Time glowing vents, coast through mud; ballast doubles bubble-elevator lift.', depth: 1540, seed: 8917, gravity: 250, friction: 1.05, amplitude: 40, frequency: .85, ramps: .65, rockiness: .1, palette: { top: '#593439', bottom: '#271f30', sand: '#d99b79', ground: '#553b3d', accent: '#ffce82' } }

  ];
  AR.VEHICLES = [
    { id: 'rover', name: 'Reef Rover', cost: 0, description: 'A dependable little explorer. Balanced in every current.', color: '#ffb547', mass: 28, wheelbase: 66, radius: 18, torque: 36000, topSpeed: 470, spring: 1500, damping: 150, travel: 25, grip: 1, oxygen: 66, buoyancy: 0.34, burst: 150, cooldown: 4.8, restLength: 24 },
    { id: 'crab', name: 'Crab Crawler', cost: 1400, description: 'Wide stance, exceptional grip, and unhurried power.', color: '#f17c6b', mass: 37, wheelbase: 91, radius: 20, torque: 50000, topSpeed: 355, spring: 2000, damping: 190, travel: 27, grip: 1.55, oxygen: 75, buoyancy: 0.28, burst: 130, cooldown: 5, restLength: 24 },
    { id: 'bike', name: 'Torpedo Bike', cost: 3000, description: 'A quick, twitchy speedster with a tiny turning profile.', color: '#62dfe0', mass: 18, wheelbase: 57, radius: 13, torque: 29000, topSpeed: 650, spring: 1450, damping: 115, travel: 19, grip: 0.95, oxygen: 55, buoyancy: 0.31, burst: 170, cooldown: 4.2, restLength: 22 },
    { id: 'truck', name: 'Abyss Truck', cost: 5400, description: 'Big wheels, a heavy hull, and an enormous oxygen tank.', color: '#f0cb61', mass: 58, wheelbase: 92, radius: 27, torque: 75000, topSpeed: 420, spring: 2600, damping: 255, travel: 32, grip: 1.25, oxygen: 112, buoyancy: 0.22, burst: 140, cooldown: 5.5, restLength: 29 },
    { id: 'manta', name: 'Manta Glider', cost: 7900, description: 'Light wings and extra buoyancy turn jumps into long glides.', color: '#b6a1f4', mass: 19, wheelbase: 76, radius: 16, torque: 28000, topSpeed: 535, spring: 1250, damping: 125, travel: 28, grip: 0.9, oxygen: 78, buoyancy: 0.61, burst: 160, cooldown: 3.8, restLength: 24 }
  ];
  AR.UPGRADES = [
    { id: 'engine', name: 'Engine', description: 'More wheel torque for stronger acceleration and climbs.', baseCost: 120, maxLevel: 12 },
    { id: 'thrust', name: 'Propeller / Thrust', description: 'A faster propeller raises cruising speed and underwater thrust.', baseCost: 150, maxLevel: 12 },
    { id: 'suspension', name: 'Suspension', description: 'Longer travel and tuned springs cushion harder landings.', baseCost: 100, maxLevel: 12 },
    { id: 'tires', name: 'Tires', description: 'Improved tread puts more engine power into the seabed.', baseCost: 110, maxLevel: 12 },
    { id: 'oxygen', name: 'Oxygen Tank', description: 'A larger oxygen reserve buys time between refills.', baseCost: 140, maxLevel: 12 },
    { id: 'ballast', name: 'Ballast', description: 'Stronger upward bursts with shorter recharge time.', baseCost: 130, maxLevel: 12 }
  ];
  AR.upgradeCost = function (id, level) {
    const upgrade = AR.UPGRADES.find(function (item) { return item.id === id; });
    if (!upgrade || level >= upgrade.maxLevel) return 0;
    return Math.round(upgrade.baseCost * Math.pow(1.39, Math.max(0, level)) / 5) * 5;
  };
  AR.getStats = function (vehicleId, levels) {
    const base = AR.VEHICLES.find(function (vehicle) { return vehicle.id === vehicleId; }) || AR.VEHICLES[0];
    const stats = Object.assign({}, base);
    const level = function (id) { return Math.max(0, Math.min(12, Number(levels && levels[id]) || 0)); };
    stats.torque *= 1 + level('engine') * 0.12;
    stats.topSpeed *= 1 + level('thrust') * 0.068;
    stats.thrustLevel = level('thrust');
    stats.spring *= 1 + level('suspension') * 0.065;
    stats.damping *= 1 + level('suspension') * 0.046;
    stats.travel += level('suspension') * 1.25;
    stats.grip *= 1 + level('tires') * 0.075;
    stats.oxygen += level('oxygen') * 8;
    stats.burst *= 1 + level('ballast') * 0.055;
    stats.cooldown *= Math.pow(0.95, level('ballast'));
    return stats;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
