import * as T from 'three';

// Routing uses sampled physical pavement curves. No straight-line fallback.
export function createPedestrianRouter(paths, buildings, height) {
  const nodes = [], adj = [], cache = new Map(), entrances = new Map(), chains = [];

  function node(v) {
    const i = nodes.length;
    nodes.push(v);
    adj.push([]);
    return i;
  }

  function link(a, b) {
    const w = nodes[a].distanceTo(nodes[b]);
    adj[a].push([b, w]);
    adj[b].push([a, w]);
  }

  function buildGraph(currentPaths, currentHeight) {
    nodes.length = 0;
    adj.length = 0;
    cache.clear();
    entrances.clear();
    chains.length = 0;

    const activePaths = (currentPaths || paths).filter(p => p.class === 1 && !p.hidden && p.curve);
    const hFn = currentHeight || height;

    for (const p of activePaths) {
      const len = p.curve.getLength();
      if (len < 0.1) continue;
      const n = Math.max(2, Math.ceil(len / 0.3));
      const ids = [];
      for (let j = 0; j <= n; j++) {
        const q = p.curve.getPointAt(j / n);
        q.y = hFn(q.x, q.z) + 0.08;
        ids.push(node(q));
        if (j > 0) link(ids[j - 1], ids[j]);
      }
      chains.push({ path: p, ids });
      if (p.id.startsWith('door:')) {
        entrances.set(p.id.slice(5), ids[0]);
      }
    }

    // Connect intersecting and touching pavement samples (centerline threshold 0.95m)
    for (let a = 0; a < chains.length; a++) {
      for (let b = a + 1; b < chains.length; b++) {
        let best = null, d = 0.95;
        for (const i of chains[a].ids) {
          for (const j of chains[b].ids) {
            const v = nodes[i].distanceTo(nodes[j]);
            if (v < d) {
              best = [i, j];
              d = v;
            }
          }
        }
        if (best) link(...best);
      }
    }
  }

  // Initial build
  buildGraph(paths, height);

  function route(source, target) {
    const key = source + '>' + target;
    if (cache.has(key)) return cache.get(key);

    const start = entrances.get(source), end = entrances.get(target);
    let result = { source, target, validationStatus: 'disconnected', nodeSequence: [], points: [], length: 0 };

    if (start !== undefined && end !== undefined) {
      const dist = new Map([[start, 0]]), prev = new Map(), open = new Set([start]);
      while (open.size) {
        let u;
        for (const n of open) {
          if (u === undefined || dist.get(n) < dist.get(u)) u = n;
        }
        open.delete(u);
        if (u === end) break;
        for (const [v, w] of adj[u]) {
          if (dist.get(u) + w < (dist.get(v) ?? Infinity)) {
            dist.set(v, dist.get(u) + w);
            prev.set(v, u);
            open.add(v);
          }
        }
      }
      if (dist.has(end)) {
        const seq = [end];
        while (seq[0] !== start) seq.unshift(prev.get(seq[0]));
        result = {
          source,
          target,
          validationStatus: 'routed',
          nodeSequence: seq,
          points: seq.map(i => nodes[i].toArray()),
          length: dist.get(end)
        };
      }
    }
    cache.set(key, result);
    return result;
  }

  function rebuild(newPaths, newHeight) {
    buildGraph(newPaths, newHeight);
  }

  return { route, rebuild, nodes, adj, entrances, cache };
}
