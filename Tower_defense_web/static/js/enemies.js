// enemies.js
// Logika przeciwników: spawn, poruszanie, synchronizacja ze stanem serwera.

(function(){
  document.addEventListener("DOMContentLoaded", () => {

    // ---- stałe / konfiguracja ----
    const CELL = 25;
    const POLL_STATE_MS = 400;
    const TIME_PER_TILE_MS = 2000;
    const SPAWN_INTERVAL_MS = 800;
    const DOT_SIZE = 10;

    // ---- helpery do obliczeń fali ----
    function hpForWave(w) {
      // HP przeciwnika dla danej fali: 1 + 3 * floor((w-1)/3)
      if (!w || w < 1) return 1;
      return 1 + 3 * Math.floor((w - 1) / 3);
    }
    function countForWave(w) {
      // liczba przeciwników: 2 ** floor((w-1)/2)
      if (!w || w < 1) return 1;
      const stages = Math.floor((w - 1) / 2);
      return Math.pow(2, stages);
    }

    // ---- stan lokalny ----
    let lastWave = null;
    let spawning = false;
    let enemies = [];
    let enemyIdCounter = 1;
    let currentPath = [];
    let pollTimer = null;
    let rafHandle = null;
    let lastRAF = null;

    const gameArea = document.getElementById("game-area");
    if (!gameArea) return;

    // ---- pozycjonowanie / rendering ----
    function cellCenterPxFromRC(r, c) {
      const x = c * CELL + Math.floor(CELL / 2);
      const y = r * CELL + Math.floor(CELL / 2);
      return [x, y];
    }

    function createEnemyDiv(id, hp) {
      // Tworzy element DOM reprezentujący wroga
      const el = document.createElement("div");
      el.className = "enemy";
      el.dataset.eid = String(id);
      el.textContent = Math.max(1, Math.ceil(hp || 1));
      Object.assign(el.style, {
        position: "absolute",
        width: `${DOT_SIZE}px`,
        height: `${DOT_SIZE}px`,
        lineHeight: `${DOT_SIZE}px`,
        textAlign: "center",
        fontSize: "12px",
        fontWeight: "bold",
        color: "#fff",
        background: "rgba(200,30,30,0.95)",
        borderRadius: "50%",
        top: "0px",
        left: "0px",
        transform: "translateZ(0)",
        pointerEvents: "none",
        zIndex: 5,
        boxSizing: "border-box",
        padding: "0",
      });
      return el;
    }

    function placeDivCenterAtPx(el, x, y) {
      el.style.left = `${Math.round(x - DOT_SIZE/2)}px`;
      el.style.top  = `${Math.round(y - DOT_SIZE/2)}px`;
    }

    // ---- usuwanie / zgłaszanie śmierci wroga ----
    // usuń wroga i zgłoś serwerowi; killer może zawierać info o tym która wieża zabiła
    function removeEnemyObj(enemy, reachedBase=false, killer=null, overkill=0) {
      if (!enemy || enemy.removing) return;
      enemy.removing = true;

      try { if (enemy.animTimer) clearTimeout(enemy.animTimer); } catch(e){}

      if (enemy.el && enemy.el.parentNode) enemy.el.parentNode.removeChild(enemy.el);
      enemies = enemies.filter(e => e.id !== enemy.id);

      const body = { count: 1 };
      if (reachedBase) {
        body.reached_base = true;
        body.hp = Math.max(1, Math.ceil(enemy.hp || 1));
      }
      if (killer && typeof killer === "object") {
        if (killer.killer_type) body.killer_type = killer.killer_type;
        if (typeof killer.killer_row !== "undefined") body.killer_row = killer.killer_row;
        if (typeof killer.killer_col !== "undefined") body.killer_col = killer.killer_col;
        if (killer.killer_id) body.killer_id = killer.killer_id;
      }
      if (overkill) body.overkill = overkill;

      fetch("/api/enemy_die", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(body)
      }).then(r => r.json().catch(()=>({})))
        .then(j => {
          // po zgłoszeniu odśwież statystyki z serwera
          fetch("/api/state").then(s => s.ok ? s.json() : Promise.reject())
            .then(st => {
              const elEnemies = document.getElementById("stat-enemies");
              if (elEnemies) elEnemies.textContent = (st.active_enemies !== undefined) ? st.active_enemies : 0;
              const elHp = document.getElementById("stat-health");
              if (elHp && st.hp !== undefined) elHp.textContent = st.hp;
              const elGold = document.getElementById("stat-gold");
              if (elGold && st.gold !== undefined) elGold.textContent = st.gold;
            }).catch(()=>{});
        }).catch(()=>{});
    }

    // zadawanie obrażeń (wywoływane z tower.js)
    function damageEnemyById(id, dmg, killer) {
      const en = enemies.find(e => e.id === id);
      if (!en) return;
      en.hp = (en.hp || 1) - Number(dmg || 0);
      if (en.el) en.el.textContent = Math.max(0, Math.ceil(en.hp));
      if (en.hp <= 0) {
        const overkill = Math.max(0, Math.ceil(-en.hp));
        removeEnemyObj(en, false, killer || null, overkill);
      }
    }

    // ---- ruch i animacja ----
    function moveAndRender(ts) {
      if (!lastRAF) lastRAF = ts;
      const deltaMs = ts - lastRAF;
      lastRAF = ts;
      const deltaSec = deltaMs / 1000;

      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i];
        if (!en.pathCells || en.pathCells.length === 0) continue;
        if (en.removing) continue;

        if (en.target_index >= en.pathCells.length) {
          // doszedł do końca ścieżki -> trafienie bazy
          removeEnemyObj(en, true);
          continue;
        }

        const tgt = en.pathCells[en.target_index];
        const [tgtR, tgtC] = tgt;
        const [tgtPxX, tgtPxY] = cellCenterPxFromRC(tgtR, tgtC);

        const dx = tgtPxX - en.x;
        const dy = tgtPxY - en.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const speedPixelsPerSec = en.speed * CELL;
        const move = speedPixelsPerSec * deltaSec;

        if (dist <= move || dist === 0) {
          en.x = tgtPxX; en.y = tgtPxY;
          en.grid_x = tgtC; en.grid_y = tgtR;
          en.target_index += 1;
        } else {
          en.x += (dx / dist) * move;
          en.y += (dy / dist) * move;
        }

        if (en.el) placeDivCenterAtPx(en.el, en.x, en.y);
      }

      rafHandle = requestAnimationFrame(moveAndRender);
    }

    // ---- pomoc: wybór najbliższego indeksu na ścieżce ----
    function findClosestIndexForPx(pxX, pxY, pathCells) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pathCells.length; i++) {
        const [r,c] = pathCells[i];
        const [cx,cy] = cellCenterPxFromRC(r,c);
        const d = Math.abs(cx - pxX) + Math.abs(cy - pxY);
        if (d < bestD) { bestD = d; best = i; }
        if (d === 0) return i;
      }
      return best;
    }

    // ---- tworzenie pojedynczego wroga lokalnie (bez zapytań do serwera) ----
    function spawnOne(hp, pathFromServer) {
      if (!Array.isArray(pathFromServer) || pathFromServer.length === 0) return null;
      const id = enemyIdCounter++;
      const el = createEnemyDiv(id, hp);
      const [sr, sc] = pathFromServer[0];
      const [startPxX, startPxY] = cellCenterPxFromRC(sr, sc);

      const enemy = {
        id: id,
        hp: hp,
        grid_x: sc,
        grid_y: sr,
        x: startPxX,
        y: startPxY,
        speed: 1 / (TIME_PER_TILE_MS / 1000),
        pathCells: pathFromServer.slice(),
        target_index: 1,
        el: el,
        removing: false
      };

      // jeśli ścieżka jest bardzo krótka — traktujemy jako natychmiastowy reach
      if (enemy.pathCells.length <= 1) {
        fetch("/api/enemy_spawn", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({count:1}) }).catch(()=>{});
        fetch("/api/enemy_die",   { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({count:1, reached_base:true, hp:enemy.hp}) }).catch(()=>{});
        return null;
      }

      gameArea.appendChild(el);
      placeDivCenterAtPx(el, enemy.x, enemy.y);
      enemies.push(enemy);

      fetch("/api/enemy_spawn", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ count: 1 })
      }).catch(()=>{});

      return enemy;
    }

    // ---- spawn fali (iteracyjnie) ----
    async function spawnWave(wave) {
      if (!wave || wave < 1) return;
      spawning = true;
      const count = countForWave(wave);
      const hp = hpForWave(wave);

      try {
        const p = await fetch("/api/path");
        if (p.ok) {
          const j = await p.json();
          if (Array.isArray(j.path)) currentPath = j.path;
        }
      } catch (e) {}

      for (let i = 0; i < count; i++) {
        if (!currentPath || currentPath.length === 0) break;
        spawnOne(hp, currentPath);
        await new Promise(res => setTimeout(res, SPAWN_INTERVAL_MS));
      }
      spawning = false;
    }

    // ---- polling stanu serwera, synchronizacja ścieżki i uruchamianie fal ----
    async function pollStateOnce() {
      try {
        const res = await fetch("/api/state");
        if (!res.ok) return;
        const st = await res.json();
        const wave = st.wave;
        const waveActive = st.wave_active;

        // pobierz aktualną ścieżkę z serwera i, jeśli zmieniła się, dopasuj istniejących wrogów
        try {
          const p = await fetch("/api/path");
          if (p.ok) {
            const j = await p.json();
            if (Array.isArray(j.path)) {
              const newPath = j.path;
              if (JSON.stringify(newPath) !== JSON.stringify(currentPath)) {
                currentPath = newPath;
                enemies.forEach(en => {
                  const idx = findClosestIndexForPx(en.x, en.y, currentPath);
                  en.pathCells = currentPath.slice();
                  en.target_index = Math.max(0, idx);
                });
              }
            }
          }
        } catch (e) {}

        // jeśli fala aktywna i trzeba wystartować spawn (nowa fala albo brak żywych)
        if (waveActive && (lastWave !== wave || (lastWave === wave && enemies.length === 0 && !spawning))) {
          lastWave = wave;
          spawnWave(wave).catch(()=>{});
        }
      } catch (e) {}
    }

    // ---- API udostępniane do debug/sterowania z konsoli ----
    window.__td_enemies = Object.assign(window.__td_enemies || {}, {
      enemies: () => enemies,
      currentPath: () => currentPath,
      spawnWaveManual: (w) => spawnWave(w),
      spawnOneManual: (hp) => spawnOne(hp, currentPath),
      damageEnemy: (id, dmg, killer) => damageEnemyById(id, dmg, killer)
    });

    // ---- uruchomienie pollingu i pętli renderującej ----
    pollTimer = setInterval(pollStateOnce, POLL_STATE_MS);
    pollStateOnce();
    rafHandle = requestAnimationFrame(moveAndRender);
  });
})();
