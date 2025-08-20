// static/js/debug_menu.js
// Niezależny panel debugowy — można go usunąć bez łamania gry.
// Panel udostępnia przyciski do dodawania zasobów oraz toggle "buffów wież".
// Komentarze znajdują się przy kluczowych funkcjach.

(function () {
    // --- konfiguracja i stan (persistowane w localStorage) ---
    let buffsEnabled = (localStorage.getItem("td_dbg_towerbuffs") === "1");
    let spacePresses = 0;
    let lastPressTime = 0;

    /**
     * Zwraca DOM element menu debugowego.
     * Tworzy przyciski do szybkiego dodawania zasobów oraz toggle buffów.
     */
    function createMenu() {
        const menu = document.createElement("div");
        menu.id = "debug-menu";

        // podstawowe style (pozycjonowanie i wygląd)
        menu.style.position = "fixed";
        menu.style.left = "225px";
        menu.style.bottom = "20px";
        menu.style.background = "rgba(0,0,0,0.85)";
        menu.style.padding = "8px";
        menu.style.border = "1px solid #555";
        menu.style.color = "#fff";
        menu.style.fontSize = "14px";
        menu.style.display = "none"; // domyślnie ukryte
        menu.style.zIndex = "9999";
        menu.style.minWidth = "200px";
        menu.style.maxWidth = "320px";
        menu.style.boxSizing = "border-box";
        menu.style.borderRadius = "4px";

        // nagłówek
        const h = document.createElement("div");
        h.textContent = "DEBUG";
        h.style.fontWeight = "700";
        h.style.marginBottom = "6px";
        menu.appendChild(h);

        // lista przycisków pomocniczych (dodawanie zasobów)
        const buttons = [
            { text: "+50 HP", action: () => addResource("hp", 50) },
            { text: "+50 złota", action: () => addResource("gold", 50) },
            { text: "+50 żywności", action: () => addResource("food", 50) },
            { text: "+50 wszystkich surowców", action: () => addAllResources(50) },
        ];

        buttons.forEach(btn => {
            const el = document.createElement("button");
            el.innerText = btn.text;
            el.style.display = "block";
            el.style.margin = "6px 0";
            el.style.width = "100%";
            el.style.boxSizing = "border-box";
            el.onclick = btn.action;
            menu.appendChild(el);
        });

        // separator wizualny
        const sep = document.createElement("hr");
        sep.style.border = "0";
        sep.style.height = "1px";
        sep.style.background = "#444";
        sep.style.margin = "8px 0";
        menu.appendChild(sep);

        // rząd z toggle dla buffów wież
        const buffRow = document.createElement("div");
        buffRow.style.display = "flex";
        buffRow.style.alignItems = "center";
        buffRow.style.justifyContent = "space-between";
        buffRow.style.gap = "8px";

        const lbl = document.createElement("div");
        lbl.textContent = "Buff wież:";
        buffRow.appendChild(lbl);

        const toggleBtn = document.createElement("button");
        toggleBtn.id = "debug-toggle-buffs";
        toggleBtn.style.flex = "0 0 auto";

        // aktualizuje etykietę przycisku na podstawie stanu
        function refreshToggleLabel() {
            toggleBtn.textContent = buffsEnabled ? "ON" : "OFF";
        }

        // obsługa kliknięcia — zapis do localStorage + dispatch eventu
        toggleBtn.onclick = () => {
            buffsEnabled = !buffsEnabled;
            localStorage.setItem("td_dbg_towerbuffs", buffsEnabled ? "1" : "0");

            // globalny obiekt dla innych skryptów (np. tower.js) do odczytu
            window.__td_debug = window.__td_debug || {};
            window.__td_debug.towerBuffsEnabled = buffsEnabled;

            // powiadomienie o zmianie (nasłuchiwane w innych plikach)
            document.dispatchEvent(new CustomEvent("td:debug:tower-buffs-changed", { detail: { enabled: buffsEnabled } }));
            refreshToggleLabel();
        };
        refreshToggleLabel();
        buffRow.appendChild(toggleBtn);

        menu.appendChild(buffRow);

        return menu;
    }

    /**
     * Wyślij żądanie do endpointa debugowego, aby dodać zasób.
     * @param {string} type - np. "gold", "wood", "hp", "food"
     * @param {number} amount
     */
    function addResource(type, amount) {
        return fetch(`/api/debug_add`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, amount })
        });
    }

    /**
     * Dodaje sekwencyjnie wszystkie podstawowe surowce,
     * wywołując addResource kolejno (żeby nie przeciążyć backendu).
     */
    async function addAllResources(amount) {
        const resources = ["wood", "stone", "iron_ore", "iron_bar", "diamond"];

        // Wysyłamy sekwencyjnie żeby backend nie został zalany
        for (const resName of resources) {
            await addResource(resName, amount);
        }
    }

    // tworzymy menu i dołączamy do dokumentu
    const menuEl = createMenu();
    document.body.appendChild(menuEl);

    // Przywracanie widoczności z localStorage (persistencja widoku)
    const persistedVisible = localStorage.getItem("debugMenuVisible") === "true";
    if (persistedVisible) {
        menuEl.style.display = "block";
    }

    /**
     * Skrót klawiszowy: 4x Space w krótkim czasie (600ms między naciśnięciami)
     * przełącza widoczność menu.
     */
    document.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            const now = Date.now();
            if (now - lastPressTime < 600) {
                spacePresses++;
            } else {
                spacePresses = 1;
            }
            lastPressTime = now;

            if (spacePresses >= 4) {
                const visible = menuEl.style.display === "block";
                menuEl.style.display = visible ? "none" : "block";
                localStorage.setItem("debugMenuVisible", !visible);
                spacePresses = 0;
            }
        }
    });

    // ustaw global flagę na start, tak aby inne skrypty mogły odczytać aktualny stan
    window.__td_debug = window.__td_debug || {};
    window.__td_debug.towerBuffsEnabled = (localStorage.getItem("td_dbg_towerbuffs") === "1");

    // wyemituj początkowe zdarzenie, aby nasłuchujące skrypty mogły je odebrać podczas ładowania
    document.dispatchEvent(new CustomEvent("td:debug:tower-buffs-changed", { detail: { enabled: window.__td_debug.towerBuffsEnabled } }));

})();
