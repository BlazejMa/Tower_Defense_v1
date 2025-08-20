// static/js/game.js

document.addEventListener("DOMContentLoaded", () => {
  const bc = document.getElementById("board-container");
  let down = false, sx = 0, sy = 0, ox = 0, oy = 0;

  // --- PRZESUWANIE PLANSZY (PAN) ---
  bc.style.cursor = "grab";
  bc.addEventListener("mousedown", e => {
    down = true;
    sx = e.clientX;
    sy = e.clientY;
    bc.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", e => {
    if (!down) return;
    down = false;
    bc.style.cursor = "grab";
    ox += e.clientX - sx;
    oy += e.clientY - sy;
  });
  window.addEventListener("mousemove", e => {
    if (!down) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    // przesuwanie całej planszy
    bc.style.transform = `translate(${ox+dx}px,${oy+dy}px)`;
  });

  // --- ROZSZERZANIE KAFELKÓW ---
  function bindExpand() {
    document.querySelectorAll(".expand-tile").forEach(div => {
      div.addEventListener("click", () => {
        const tx = +div.dataset.tx, ty = +div.dataset.ty;
        // wywołanie API do rozszerzenia mapy
        fetch("/api/expand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tx, ty })
        })
        .then(r => r.json())
        .then(res => {
          if (res.ok) location.reload();
          else alert("Nie można rozszerzyć tego kafelka.");
        })
        .catch(console.error);
      });
    });
  }

  // --- BUDOWANIE NA GŁÓWNEJ PLANSZY ---
  let selectedType = null;
  function bindMainMenu() {
    // wybór typu budynku z menu
    document.querySelectorAll("#menu button").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.type;
        if (selectedType === t) {
          btn.classList.remove("selected");
          selectedType = null;
        } else {
          document.querySelectorAll("#menu button").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedType = t;
        }
      });
    });

    // kliknięcie w planszę = próba budowy
    bc.addEventListener("click", e => {
      if (!selectedType) return;
      const rect = bc.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / 25);
      const y = Math.floor((e.clientY - rect.top)  / 25);

      // API build
      fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedType, x, y })
      })
      .then(async response => {
        const data = await response.json();
        if (response.ok) {
          location.reload();
        } else {
          alert(data.error || "Nie można postawić struktury.");
        }
      })
      .catch(err => {
        console.error("Błąd sieci przy stawianiu struktury:", err);
        alert("Błąd sieci, spróbuj ponownie.");
      })
      .finally(() => {
        // reset wyboru
        selectedType = null;
        document.querySelectorAll("#menu button").forEach(b => b.classList.remove("selected"));
      });
    });
  }

  // --- BUDOWANIE W OBOZIE ---
  let selectedCamp = null;
  function bindCampMenu() {
    // wybór budynku w menu obozu
    document.querySelectorAll("#camp-menu button").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.camp;
        if (selectedCamp === t) {
          btn.classList.remove("selected");
          selectedCamp = null;
        } else {
          document.querySelectorAll("#camp-menu button").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedCamp = t;
        }
      });
    });

    // kliknięcie w komórkę obozu
    document.querySelectorAll(".camp-cell").forEach(div => {
      div.addEventListener("click", () => {
        if (!selectedCamp) return;
        const x = +div.dataset.x, y = +div.dataset.y;
        // API build_camp
        fetch("/api/build_camp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x, y, type: selectedCamp })
        })
        .then(async response => {
          const data = await response.json();
          if (response.ok) {
            div.classList.add("building");
            // przypisanie litery symbolizującej budynek
            if      (selectedCamp === "house")        div.textContent = "D";
            else if (selectedCamp === "mansion")      div.textContent = "P";
            else if (selectedCamp === "farm")         div.textContent = "F";
            else if (selectedCamp === "sawmill")      div.textContent = "T";
            else if (selectedCamp === "quarry")       div.textContent = "K";
            else if (selectedCamp === "iron_mine")    div.textContent = "KŻ";
            else if (selectedCamp === "smelter")      div.textContent = "HŻ";
            else if (selectedCamp === "diamond_mine") div.textContent = "KD";
          } else {
            alert(data.error || "Nie można postawić budynku w tym miejscu obozu.");
          }
        })
        .catch(err => {
          console.error("Błąd sieci przy budowie w obozie:", err);
          alert("Błąd sieci, spróbuj ponownie.");
        })
        .finally(() => {
          // reset wyboru
          selectedCamp = null;
          document.querySelectorAll("#camp-menu button").forEach(b => b.classList.remove("selected"));
        });
      });
    });
  }

  // --- STEROWANIE FALAMI ---
  const btnStart = document.getElementById("btn-start-wave");
  if (btnStart) {
    btnStart.addEventListener("click", () => {
      // API start_wave
      fetch("/api/start_wave", { method: "POST" })
        .then(r => r.json())
        .then(res => {
          if (!res.ok) return;
          // serwer sam zakończy falę, nie trzeba timeoutu
        })
        .catch(console.error);
    });
  }

  // --- DYNAMICZNE ODŚWIEŻANIE STATYSTYK ---
  function updateStats() {
    fetch("/api/state")
      .then(r => {
        if (!r.ok) throw new Error("Nie udało się pobrać stanu gry");
        return r.json();
      })
      .then(data => {
        // --- zasoby obozu ---
        const klucze = ["wood","stone","iron_ore","iron_bar","diamond"];
        klucze.forEach((k, i) => {
          const wiersz = document.querySelectorAll("#stats-camp tr")[i];
          if (!wiersz) return;
          const kom = wiersz.querySelector("td:nth-child(2)");
          if (!kom) return;
          kom.textContent = data.resources[k];
          // usuń stare znaczniki income
          kom.querySelectorAll("span.income").forEach(el => el.remove());
          const inc = data.income[k] || 0;
          if (inc !== 0) {
            const span = document.createElement("span");
            span.classList.add("income", inc > 0 ? "positive" : "negative");
            span.textContent = (inc > 0 ? "+" : "") + inc;
            kom.appendChild(document.createTextNode(" ("));
            kom.appendChild(span);
            kom.appendChild(document.createTextNode(")"));
          }
        });

        // --- żywność ---
        const komFood = document.getElementById("stat-food");
        if (komFood) {
          komFood.textContent = data.food;
          komFood.querySelectorAll("span.income").forEach(el => el.remove());
          const incF = data.income.food || 0;
          if (incF !== 0) {
            const s = document.createElement("span");
            s.classList.add("income", incF > 0 ? "positive" : "negative");
            s.textContent = (incF > 0 ? "+" : "") + incF;
            komFood.appendChild(document.createTextNode(" ("));
            komFood.appendChild(s);
            komFood.appendChild(document.createTextNode(")"));
          }
        }

        // --- inne statystyki ---
        const elPeas = document.getElementById("stat-peasants");
        if (elPeas) elPeas.textContent = data.peasants;
        const elUnemp = document.getElementById("stat-unemployed");
        if (elUnemp) elUnemp.textContent = data.unemployed;
        const elHp = document.getElementById("stat-health");
        if (elHp) elHp.textContent = data.hp;
        const elGold = document.getElementById("stat-gold");
        if (elGold) elGold.textContent = data.gold;
        const elWave = document.getElementById("stat-wave");
        if (elWave) elWave.textContent = data.wave;
        const elTime = document.getElementById("stat-time");
        if (elTime) elTime.textContent = (data.time !== undefined ? data.time + " s" : "");

        // liczba żywych przeciwników
        const elEnemies = document.getElementById("stat-enemies");
        const activeEnemies = (data.active_enemies !== undefined) ? data.active_enemies : 0;
        if (elEnemies) elEnemies.textContent = activeEnemies;

        // --- BLOKOWANIE UI gdy są żywi przeciwnicy ---
        const buttons = document.querySelectorAll("#menu button, #camp-menu button, #upgrade-menu button");
        buttons.forEach(btn => {
          if (activeEnemies > 0) {
            btn.disabled = true;
            btn.classList.add("disabled-by-enemies");
          } else {
            btn.disabled = false;
            btn.classList.remove("disabled-by-enemies");
          }
        });

        const btnStart = document.getElementById("btn-start-wave");
        if (btnStart) {
          if (activeEnemies > 0) {
            btnStart.disabled = true;
            btnStart.title = "Nie można rozpocząć nowej fali, są żywi przeciwnicy";
          } else {
            btnStart.disabled = false;
            btnStart.title = "Start fali";
          }
        }

        // blokada expand-tile gdy są przeciwnicy
        document.querySelectorAll(".expand-tile").forEach(div => {
          if (activeEnemies > 0) {
            div.style.pointerEvents = "none";
            div.style.opacity = "0.5";
          } else {
            div.style.pointerEvents = "";
            div.style.opacity = "1";
          }
        });
      })
      .catch(err => {
        console.error("updateStats error:", err);
      });
  }
  setInterval(updateStats, 1000);
  updateStats();

  // --- INICJALIZACJA ---
  bindExpand();
  bindMainMenu();
  bindCampMenu();
});
