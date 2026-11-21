/**
 * district-layout.js
 * Geometry of the client districts declared in physical-topology.json
 * (expansion.clientDistricts). Shared by the terrain, which levels the land
 * of every slot, and by client-districts.js, which draws on it.
 *
 * A slot is described from its gate: u runs from the gate away from the
 * campus, v runs across the slot. Lot numbers are fixed by this file and
 * the topology alone, so a lot never moves when projects come and go.
 */
const SIDE_ROTATION = {E: 0, N: Math.PI / 2, W: Math.PI, S: -Math.PI / 2};

export function districtPlan(L) {
  const plan = L?.expansion?.clientDistricts;
  return plan?.slots?.length ? plan : null;
}

/** Local frame of a slot: rotY for a group placed at the gate, and (u, v) -> world [x, z]. */
export function slotFrame(slot, template) {
  const rotY = SIDE_ROTATION[slot.side] ?? 0, cos = Math.round(Math.cos(rotY)), sin = Math.round(Math.sin(rotY));
  const [gx, gz] = slot.gateXZ, depth = slot.depth, half = template.width / 2;
  const toWorld = (u, v) => [gx + u * cos + v * sin, gz - u * sin + v * cos];
  const [cx, cz] = toWorld(depth / 2, 0);
  return {
    rotY, depth, half, toWorld,
    y: slot.groundY ?? 0,
    center: [cx, cz],
    halfExtent: [Math.abs(cos) * depth / 2 + Math.abs(sin) * half, Math.abs(sin) * depth / 2 + Math.abs(cos) * half]
  };
}

/** The level pad the terrain keeps under each slot. */
export function districtGroundPads(L, margin = 4) {
  const plan = districtPlan(L);
  if (!plan) return [];
  return plan.slots.map(slot => {
    const f = slotFrame(slot, plan.template);
    return {id: slot.id, x: f.center[0], z: f.center[1], hx: f.halfExtent[0] + margin, hz: f.halfExtent[1] + margin, y: f.y};
  });
}

/** Every lot of a slot, lot 1 nearest the gate: {n, id, u, v, side}; (u, v) is the lot centre. */
export function slotLots(slot, template) {
  const lots = [], [, lotDepth] = template.lotSize;
  for (let n = 1; n <= slot.lots; n++) {
    const row = Math.floor((n - 1) / 2), side = n % 2 ? -1 : 1;
    lots.push({
      n,
      id: 'lot:' + slot.label + ':' + String(n).padStart(2, '0'),
      u: template.firstLotAt + template.lotPitch * (row + 0.5),
      v: side * (template.lotSetback + lotDepth / 2),
      side
    });
  }
  return lots;
}

/** Lots served by the road today: the opened phase, grown in pairs when projects need more. */
export function openLotCount(slot, template, used = 0) {
  const base = slot.openLots ?? template.openLots;
  return Math.min(slot.lots, Math.max(base, used + (used % 2)));
}

/** How far the internal road runs for a number of open lots. */
export function spineEnd(template, open) {
  return template.firstLotAt + template.lotPitch * Math.ceil(open / 2) + 5;
}
