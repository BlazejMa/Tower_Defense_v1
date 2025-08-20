// tower.js

document.addEventListener("DOMContentLoaded", () => {
  const CELL = 25;
  const PROJECTILE_TRAVEL_MS = 180;
  const PROJECTILE_SIZE_PX = 6;

  function fetchJson(url) {
    return fetch(url).then(r => r.ok ? r.json() : Promise.reject(r.status));
  }

  function cellCenterPxFromRC(r, c) {
    const x = c * CELL + Math.floor(CELL / 2);
    const y = r * CELL + Math.floor(CELL / 2);
    return [x, y];
  }

  function parseTopLeftToRC(styleTop, styleLeft) {
    const top = parseInt(styleTop, 10) || 0;
    const left = parseInt(styleLeft, 10) || 0;
    const r = Math.round(top / CELL);
    const c = Math.round(left / CELL);
    return [r, c];
  }

  let stanGry = {};

  async function pobierzStan() {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error("state fetch failed");
      stanGry = await res.json();
    } catch (e) {
      stanGry = {};
    }
  }

  const btnToggle = document.querySelector(".upgrade-button");
  const controls  = document.querySelector(".upgrade-controls");
  const lista     = document.getElementById("upgrade-list");

  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      const widoczne = controls.style.display === "block";
      controls.style.display = widoczne ? "none" : "block";
      lista.style.display   = widoczne ? "none" : "block";
      if (!widoczne) filtrujUlepszenia();
    });
  }

  function filtrujUlepszenia() {
    const typEl = document.getElementById("upgrade-tower-type");
    const katEl = document.getElementById("upgrade-category");
    if (!typEl || !katEl) return;
    const typ = typEl.value;
    const kategoria = katEl.value;

    document.querySelectorAll("#upgrade-list li").forEach(li => {
      li.style.display = "none";
    });

    const dopasowane = document.querySelectorAll(
      `#upgrade-list .upgrade-action[data-tower-type="${typ}"][data-category="${kategoria}"], #upgrade-list .no-upgrades[data-tower-type="${typ}"][data-category="${kategoria}"]`
    );
    dopasowane.forEach(li => li.style.display = "");

    podlaczKupowanie();
  }

  function podlaczKupowanie() {
    // odłącz/ponownie podłącz listenery (clone trick żeby usunąć stare)
    document.querySelectorAll("#upgrade-list .buy-upgrade").forEach(btn => {
      btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll("#upgrade-list .buy-upgrade").forEach(btn => {
      btn.addEventListener("click", async e => {
        const li = e.currentTarget.closest("li");
        if (!li) return;
        await pobierzStan();

        const koszty = {
          wood:     +li.dataset.costWood     || 0,
          stone:    +li.dataset.costStone    || 0,
          iron_ore: +(li.dataset.costIronOre  ?? li.dataset.costIron_ore)  || 0,
          iron_bar: +(li.dataset.costIronBar  ?? li.dataset.costIron_bar)  || 0,
          diamond:  +li.dataset.costDiamond  || 0,
          food:     +li.dataset.costFood     || 0,
        };

        const brakuje = [];
        for (let key in koszty) {
          const posiadane = (key === "food") ? (stanGry.food || 0) : (stanGry.resources && stanGry.resources[key] ? stanGry.resources[key] : 0);
          if (posiadane < koszty[key]) {
            brakuje.push(`${koszty[key] - posiadane} ${key}`);
          }
        }
        if (brakuje.length) {
          alert("Nie można kupić ulepszenia – brakuje:\n" + brakuje.join("\n"));
          return;
        }

        fetch("/api/upgrade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tower_type:    li.dataset.towerType,
            category:      li.dataset.category,
            upgrade_index: +li.dataset.upgradeIndex
          })
        })
        .then(async r => {
          const data = await r.json().catch(()=>({}));
          if (r.ok && data.ok) {
            location.reload();
          } else {
            alert("Nie udało się zastosować ulepszenia:\n" + (data.error || "Nieznany błąd"));
          }
        })
        .catch(() => {
          alert("Błąd sieci, spróbuj ponownie.");
        });
      });
    });
  }

  const selType = document.getElementById("upgrade-tower-type");
  const selCat  = document.getElementById("upgrade-category");
  if (selType) selType.addEventListener("change", filtrujUlepszenia);
  if (selCat)  selCat.addEventListener("change", filtrujUlepszenia);

  function debugBuffsEnabled() {
    if (window.__td_debug && typeof window.__td_debug.towerBuffsEnabled !== "undefined") {
      return !!window.__td_debug.towerBuffsEnabled;
    }
    return localStorage.getItem("td_dbg_towerbuffs") === "1";
  }

  function applyDebugBuffToSpec(spec) {
    if (!spec) return spec;
    if (!debugBuffsEnabled()) return spec;
    return {
      range:  (Number(spec.range)  || 0) + 5,
      damage: (Number(spec.damage) || 0) + 10,
      speed:  (Number(spec.speed)  || 0) + 5,
      strategic: !!spec.strategic
    };
  }

  const gameArea = document.getElementById("game-area");
  if (!gameArea) return;

  function getLiveEnemies() {
    try {
      if (window.__td_enemies && typeof window.__td_enemies.enemies === "function") {
        return window.__td_enemies.enemies();
      }
    } catch (e) {}
    return [];
  }

  function enemyGridPos(enemy) {
    if (!enemy) return null;
    if (typeof enemy.grid_y !== "undefined" && typeof enemy.grid_x !== "undefined") {
      return [enemy.grid_y, enemy.grid_x];
    }
    if (typeof enemy.row !== "undefined" && typeof enemy.col !== "undefined") {
      return [enemy.row, enemy.col];
    }
    if (Array.isArray(enemy.pos) && enemy.pos.length >= 2) {
      return [enemy.pos[0], enemy.pos[1]];
    }
    if (enemy.el && enemy.el.style) {
      const top = parseInt(enemy.el.style.top || 0, 10);
      const left = parseInt(enemy.el.style.left || 0, 10);
      return [Math.round(top / CELL), Math.round(left / CELL)];
    }
    return null;
  }

  function enemyCenterPx(enemy) {
    if (!enemy) return null;
    if (enemy.el instanceof Element) {
      const enemyRect = enemy.el.getBoundingClientRect();
      const areaRect = gameArea.getBoundingClientRect();
      const centerX = (enemyRect.left - areaRect.left) + enemyRect.width / 2;
      const centerY = (enemyRect.top  - areaRect.top ) + enemyRect.height / 2;
      return [centerX, centerY];
    }
    const gp = enemyGridPos(enemy);
    if (gp) return cellCenterPxFromRC(gp[0], gp[1]);
    return null;
  }

  function pixelDistance(aPx, bPx) {
    const dx = aPx[0] - bPx[0];
    const dy = aPx[1] - bPx[1];
    return Math.sqrt(dx*dx + dy*dy);
  }

  function fireProjectile(fromPx, toPx, onHit) {
    const dot = document.createElement("div");
    dot.className = "tower-projectile";
    Object.assign(dot.style, {
      position: "absolute",
      width: `${PROJECTILE_SIZE_PX}px`,
      height: `${PROJECTILE_SIZE_PX}px`,
      left: `${Math.round(fromPx[0])}px`,
      top: `${Math.round(fromPx[1])}px`,
      transform: `translate(-50%,-50%)`,
      borderRadius: "50%",
      background: "#fff",
      zIndex: 10,
      pointerEvents: "none",
      willChange: "transform"
    });

    dot.style.transition = `transform ${PROJECTILE_TRAVEL_MS}ms linear`;
    gameArea.appendChild(dot);

    const dx = (toPx[0] - fromPx[0]);
    const dy = (toPx[1] - fromPx[1]);

    requestAnimationFrame(() => {
      dot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%,-50%)`;
    });

    setTimeout(() => {
      try { if (dot && dot.parentNode) dot.parentNode.removeChild(dot); } catch(e){}
      if (typeof onHit === "function") onHit();
    }, PROJECTILE_TRAVEL_MS + 20);

    setTimeout(() => {
      try { if (dot && dot.parentNode) dot.parentNode.removeChild(dot); } catch(e){}
    }, 3000);
  }

  function doShoot(tower, targetEnemy) {
    const towerCenter = cellCenterPxFromRC(tower.row, tower.col);
    const enemyPx = enemyCenterPx(targetEnemy) || towerCenter;

    fireProjectile(towerCenter, enemyPx, () => {
      try {
        const killer = {
          killer_type: tower.type,
          killer_row: tower.row,
          killer_col: tower.col,
          killer_id: tower.id
        };
        if (window.__td_enemies && typeof window.__td_enemies.damageEnemy === "function") {
          // preferowana metoda (klient lokalny)
          window.__td_enemies.damageEnemy(targetEnemy.id, tower.damage, killer);
        } else {
          // fallback — nie powinno być wykorzystywane gdy enemies.js jest aktywne
          fetch("/api/enemy_damage", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ id: targetEnemy.id, damage: tower.damage, killer_type: tower.type, killer_row: tower.row, killer_col: tower.col })
          }).catch(()=>{});
        }
      } catch (e) {}
    });

    tower._lastShotMs = performance.now();

    // efekt wizualny dla struktury (krótkie podświetlenie)
    const allStructs = document.querySelectorAll(".structure");
    for (let s of allStructs) {
      const top = parseInt(s.style.top || 0, 10);
      const left = parseInt(s.style.left || 0, 10);
      const [r, c] = [Math.round(top / CELL), Math.round(left / CELL)];
      if (r === tower.row && c === tower.col) {
        s.style.boxShadow = "0 0 8px 3px rgba(255,255,255,0.6)";
        setTimeout(() => { s.style.boxShadow = ""; }, 120);
        break;
      }
    }
  }

  let rafHandle = null;
  let lastTs = null;

  function rafLoop(ts) {
    if (!lastTs) lastTs = ts;
    const nowMs = performance.now();
    lastTs = ts;

    const live = getLiveEnemies();
    if (!Array.isArray(live)) {
      rafHandle = requestAnimationFrame(rafLoop);
      return;
    }

    for (const tw of towers) {
      if (!tw.speed || tw.speed <= 0) continue;
      const cooldownMs = 1000 / Math.max(1e-6, Number(tw.speed) || 0);
      if (!tw._lastShotMs) tw._lastShotMs = 0;
      if ((nowMs - tw._lastShotMs) < cooldownMs) continue;

      const towerCenterPx = cellCenterPxFromRC(tw.row, tw.col);
      const rangePx = (Number(tw.range) || 0) * CELL;

      let best = null, bestD = Infinity;
      for (const e of live) {
        const ep = enemyCenterPx(e);
        if (!ep) continue;
        const dpx = pixelDistance(towerCenterPx, ep);
        if (dpx <= rangePx + 1e-6) {
          if (dpx < bestD) { bestD = dpx; best = e; }
        }
      }

      if (!best) continue;

      // Jeśli wieża ma strategiczny upgrade — tymczasowo oznacza to PODWÓJNY STRZAŁ:
      // strzela do dwóch najbliższych celów (jeśli są).
      if (tw.strategic) {
        const inRange = live
          .map(e => ({ e, ep: enemyCenterPx(e) }))
          .filter(x => x.ep && pixelDistance(towerCenterPx, x.ep) <= rangePx + 1e-6)
          .sort((a,b) => pixelDistance(towerCenterPx, a.ep) - pixelDistance(towerCenterPx, b.ep));
        for (let i = 0; i < Math.min(2, inRange.length); i++) {
          doShoot(tw, inRange[i].e);
        }
      } else {
        doShoot(tw, best);
      }
    }

    rafHandle = requestAnimationFrame(rafLoop);
  }

  let towers = [];
  async function initTowers() {
    let towerSpecsMap = {};
    try { towerSpecsMap = await fetchJson("/api/tower_specs"); } catch (e) { towerSpecsMap = {}; }
    let state = {};
    try { state = await fetchJson("/api/state"); } catch (e) { state = {}; }

    towers = [];
    if (Array.isArray(state.structures)) {
      for (const s of state.structures) {
        const typ = s.t;
        if (!typ || !typ.startsWith("tower")) continue;
        const row = s.y;
        const col = s.x;
        const specs = towerSpecsMap[typ] || { range: 0, speed: 0, damage: 0, strategic: false };

        const orig = {
          range: Number(specs.range) || 0,
          speed: Number(specs.speed) || 0,
          damage: Number(specs.damage) || 0,
          strategic: !!specs.strategic
        };

        const applied = applyDebugBuffToSpec(orig);

        towers.push({
          id: `${typ}_${row}_${col}`,
          type: typ,
          row: row,
          col: col,
          range: applied.range,
          speed: applied.speed,
          damage: applied.damage,
          strategic: applied.strategic,
          _lastShotMs: 0,
          _origSpec: orig
        });
      }
    }

    // Nie stosujemy lokalnych aury (tower5) — serwer obecnie nie używa skomplikowanych efektów
    // (tymczasowo strategiczne = podwójny strzał, więc nic więcej nie trzeba robić)

    const structEls = document.querySelectorAll(".structure");
    structEls.forEach(el => {
      el.addEventListener("mouseenter", () => {
        const [r, c] = parseTopLeftToRC(el.style.top, el.style.left);
        const towerObj = towers.find(t => t.row === r && t.col === c);
        if (!towerObj) return;
        showRangeForTower(towerObj);
      });
      el.addEventListener("mouseleave", () => {
        clearRangeOverlay();
      });
    });

    document.addEventListener("td:debug:tower-buffs-changed", () => {
      applyDebugBuffsToTowers();
      clearRangeOverlay();
    });

    if (!rafHandle) {
      rafHandle = requestAnimationFrame(rafLoop);
    }
  }

  function applyDebugBuffsToTowers() {
    const enabled = debugBuffsEnabled();
    for (const tw of towers) {
      if (!tw._origSpec) continue;
      if (enabled) {
        tw.range = tw._origSpec.range + 5;
        tw.damage = tw._origSpec.damage + 10;
        tw.speed = tw._origSpec.speed + 5;
        tw.strategic = !!tw._origSpec.strategic;
      } else {
        tw.range = tw._origSpec.range;
        tw.damage = tw._origSpec.damage;
        tw.speed = tw._origSpec.speed;
        tw.strategic = !!tw._origSpec.strategic;
      }
    }
    // lokalne aury były usunięte — nic więcej do resetu
  }

  let rangeOverlayEls = [];
  function clearRangeOverlay() {
    for (const e of rangeOverlayEls) {
      e.classList.remove("in-range");
    }
    rangeOverlayEls = [];
  }

  function showRangeForTower(towerObj) {
    clearRangeOverlay();
    const r0 = towerObj.row, c0 = towerObj.col;
    const allCells = document.querySelectorAll("#game-area .cell");
    allCells.forEach(cell => {
      const top = parseInt(cell.style.top || 0, 10);
      const left = parseInt(cell.style.left || 0, 10);
      const r = Math.round(top / CELL);
      const c = Math.round(left / CELL);
      const dr = r0 - r, dc = c0 - c;
      const d = Math.sqrt(dr*dr + dc*dc);
      if (d <= (Number(towerObj.range) || 0) + 0.0001) {
        cell.classList.add("in-range");
        rangeOverlayEls.push(cell);
      }
    });
  }

  (function ensureRangeStyle(){
    if (!document.getElementById("__td_range_style")) {
      const s = document.createElement("style");
      s.id = "__td_range_style";
      s.textContent = `
        .in-range { outline: 2px solid rgba(0,255,0,0.6); box-shadow: 0 0 6px rgba(0,255,0,0.12) !important; }
        .tower-projectile { will-change: transform; border: 0; }
      `;
      document.head.appendChild(s);
    }
  })();

  (async () => {
    await pobierzStan();
    filtrujUlepszenia();
    podlaczKupowanie();
    initTowers().catch(() => {});
  })();

});
