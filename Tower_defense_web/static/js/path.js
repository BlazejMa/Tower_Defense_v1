// static/js/path.js
document.addEventListener("DOMContentLoaded", () => {
  const gameArea = document.getElementById("game-area");
  const CELL_SIZE = 25;

  // usuwa wizualizację ścieżki
  function clearPath() {
    document.querySelectorAll(".path-cell").forEach(el => el.remove());
  }

  // normalizuje różne formaty punktów do [r, c]
  function normalizePoint(p) {
    if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])];
    if (p && typeof p === "object") {
      if (p.r !== undefined && p.c !== undefined) return [Number(p.r), Number(p.c)];
      if (p.y !== undefined && p.x !== undefined) return [Number(p.y), Number(p.x)];
      if (p.row !== undefined && p.col !== undefined) return [Number(p.row), Number(p.col)];
    }
    return null;
  }

  // pobiera i rysuje ścieżkę z serwera
  async function drawPath() {
    try {
      const res = await fetch("/api/path");
      if (!res.ok) { clearPath(); console.warn("/api/path status", res.status); return; }
      const data = await res.json();
      const pathRaw = data.path;
      clearPath();
      if (!Array.isArray(pathRaw) || pathRaw.length < 3) return;
      const path = pathRaw.map(normalizePoint).filter(p => p !== null);
      if (path.length < 3) return;

      // rysuje segmenty ścieżki
      for (let i = 1; i < path.length - 1; i++) {
        const [r, c] = path[i];
        const prev = path[i-1];
        const next = path[i+1];
        if (!prev || !next) continue;
        const drPrev = r - prev[0], dcPrev = c - prev[1];
        const drNext = next[0] - r, dcNext = next[1] - c;

        const div = document.createElement("div");
        div.classList.add("path-cell");
        if (drPrev === 0 && drNext === 0) div.classList.add("h");   // poziomy
        else if (dcPrev === 0 && dcNext === 0) div.classList.add("v"); // pionowy
        else div.classList.add("corner"); // zakręt
        div.style.top = `${r * CELL_SIZE}px`;
        div.style.left = `${c * CELL_SIZE}px`;
        gameArea.appendChild(div);
      }
    } catch (e) {
      console.error("Błąd przy rysowaniu ścieżki:", e);
      clearPath();
    }
  }

  // lokalna symulacja BFS – sprawdza czy po budowie nadal istnieje ścieżka
  function clientPathExists(state, simR, simC, simType) {
    const grid = state.grid2d;
    const rows = grid.length;
    if (!rows) return true;
    const cols = grid[0].length;
    const structSet = new Set((state.structures || []).map(s => `${s.y},${s.x}`));
    const simKey = `${simR},${simC}`;

    // znajdź portal i bazę
    let start = null, goal = null;
    for (let i=0;i<rows;i++){
      for (let j=0;j<cols;j++){
        if (grid[i][j]==="portal") start=[i,j];
        if (grid[i][j]==="base") goal=[i,j];
      }
    }
    if (!start || !goal) return true;

    // sprawdza czy pole jest przechodnie
    function isWalkable(r,c){
      if (r<0||r>=rows||c<0||c>=cols) return false;
      const v = grid[r][c];
      if (v==="void" || v==="wall") return false;
      if (structSet.has(`${r},${c}`)) return false;  // istniejąca struktura blokuje
      if (`${r},${c}` === simKey) return false;      // symulowana budowa blokuje
      return (v==="open_area"||v==="tower_area"||v==="base_area"||v==="base"||v==="portal");
    }

    // BFS od portalu do bazy
    const q=[];
    const visited=new Set();
    q.push(start);
    visited.add(`${start[0]},${start[1]}`);
    const dirs=[[0,1],[1,0],[0,-1],[-1,0]];
    while(q.length){
      const [x,y]=q.shift();
      if (x===goal[0] && y===goal[1]) return true;
      for(const [dx,dy] of dirs){
        const nx=x+dx, ny=y+dy;
        const key=`${nx},${ny}`;
        if (!visited.has(key) && isWalkable(nx,ny)){
          visited.add(key);
          q.push([nx,ny]);
        }
      }
    }
    return false;
  }

  // przechwytuje fetch -> klient robi wstępny check zanim wyśle budowę
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const url = (typeof input==="string")?input:(input&&input.url)||"";
    const method = (init&&init.method)?init.method.toUpperCase():"GET";

    if (method==="POST" && url.includes("/api/build")){
      try {
        const body = init && init.body ? JSON.parse(init.body) : null;
        if (!body) return originalFetch(input, init);
        const typ = body.type;
        const x = parseInt(body.x,10);
        const y = parseInt(body.y,10);

        // pobierz stan i sprawdź czy ścieżka istnieje
        const stRes = await originalFetch("/api/state");
        const state = await stRes.json();
        const ok = clientPathExists(state, y, x, typ);
        if (!ok){
          // symulacja blokuje drogę -> odrzucamy lokalnie
          const fake = new Response(JSON.stringify({ ok:false, error:"Budowa zablokuje drogę" }), {
            status:400,
            headers: { "Content-Type":"application/json; charset=utf-8" }
          });
          return fake;
        }

        // normalne wysłanie do serwera
        const resp = await originalFetch(input, init);

        // po odpowiedzi odśwież ścieżkę kilka razy (dla pewności)
        try {
          if (window.drawPath) window.drawPath();
          setTimeout(()=>{ try{ if(window.drawPath) window.drawPath(); }catch(e){} },50);
          setTimeout(()=>{ try{ if(window.drawPath) window.drawPath(); }catch(e){} },200);
          setTimeout(()=>{ try{ if(window.drawPath) window.drawPath(); }catch(e){} },600);
        }catch(e){}

        return resp;
      } catch(e) {
        console.error("Pre-build simulation failed, sending request to server:", e);
        const resp = await originalFetch(input, init);
        try { if(window.drawPath) window.drawPath(); } catch(err){}
        return resp;
      }
    }

    return originalFetch(input, init);
  };

  // pierwsze rysowanie i cykliczne odświeżanie ścieżki
  drawPath();
  setInterval(drawPath, 500);
  window.drawPath = drawPath;
});
