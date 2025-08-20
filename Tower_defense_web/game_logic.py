# game_logic.py
"""
Logika planszy/gry: klasa Board zarządza planszą, kafelkami, obozem,
strukturami, falami i zasobami.
"""
import os
import random
import time
from collections import deque
from tower_logic import STRUCTURE_BASE


class Board:
    def __init__(self):
        # ---- rozmiary i plansza główna ----
        self.tile_size = 5
        self.num_tiles = 5
        self.total_rows = self.total_cols = self.num_tiles * self.tile_size
        self.grid = [["void"] * self.total_cols
                     for _ in range(self.total_rows)]
        self.active_tiles = set()

        # ---- ekspansja kafelków (baza i portale) ----
        self.base_tile = None
        self.first_tile_placed = False
        self.latest_tile = None
        self.current_portal = None

        # ---- separator i obóz ----
        self.separator_y = self.total_rows
        self.camp_w_tiles = 3
        self.camp_h_tiles = 2
        self.camp_origin_row = self.separator_y + 1
        self.camp_origin_col = (self.total_cols - self.camp_w_tiles*self.tile_size)//2
        self.camp = {}
        self.camp_buildings = {}
        self.init_camp()

        # ---- tła losowane z katalogu static/img ----
        img_dir = os.path.join(os.path.dirname(__file__), "static", "img")
        self._bg_candidates = [f for f in os.listdir(img_dir)
                               if f.lower().endswith((".png", ".jpg", ".jpeg"))]
        self.bg_image = None

        # ---- statystyki gry ----
        self.hp = 25
        self.gold = 25
        self.wave = 0
        self.wave_active = False
        self.wave_start_time = None
        self.elapsed_time = 0

        # liczba aktywnych przeciwników (aktualizowana przez endpointy /api/enemy_spawn i /api/enemy_die)
        self.active_enemies = 0
        self._hp_before_wave = self.hp
        self._expected_enemies = 0
        self._spawned_in_wave = 0

        # ---- surowce obozu i siła robocza ----
        self.resources = {
            "wood":     0,
            "stone":    0,
            "iron_ore": 0,
            "iron_bar": 0,
            "diamond":  0
        }
        self.peasants = 0
        self.unemployed = 0
        self.food = 6

        # przychody „na dzień” (będzie nadpisywane w end_wave)
        self.income = {k: 0 for k in ("wood", "stone", "iron_ore", "iron_bar", "diamond", "food")}

        # ---- struktury na głównej planszy ----
        self.structures = {}  # {(r,c): "wall"/"tower1"/...}

    # -----------------------
    # KONFIGURACJA OBOZU / POMOCNICZE
    # -----------------------
    def init_camp(self):
        """Wypełnia obóz (camp) symbolami: 'O' dla pola, 'B' dla bazy obozu."""
        ts = self.tile_size
        for dr in range(self.camp_h_tiles * ts):
            for dc in range(self.camp_w_tiles * ts):
                r = self.camp_origin_row + dr
                c = self.camp_origin_col + dc
                tx = dc // ts
                ty = dr // ts
                if tx == 1 and ty == 1 and dc % ts == ts//2 and dr % ts == ts//2:
                    t = "B"
                else:
                    t = "O"
                self.camp[(r, c)] = t

    # -----------------------
    # ZARZĄDZANIE KAFELKAMI (tile expansion, base, portal)
    # -----------------------
    def activate_tile(self, tx, ty):
        """
        Aktywuje kafelek (tx,ty) — ustawia pola 'void' wewnątrz kafelka na 'open_area'
        oraz dodaje go do zestawu aktywnych kafelków.
        """
        sr, sc = ty*self.tile_size, tx*self.tile_size
        self.active_tiles.add((tx, ty))
        for r in range(sr, sr+self.tile_size):
            for c in range(sc, sc+self.tile_size):
                if self.grid[r][c] == "void":
                    self.grid[r][c] = "open_area"

    def init_base_at(self, tx, ty):
        """
        Inicjuje bazę w kafelku (tx,ty): ustawia 'base_area', wewnętrzne 'tower_area'
        oraz centralne pole 'base' i otaczające mury.
        """
        ts = self.tile_size
        sr, sc = ty*ts, tx*ts
        for r in range(sr, sr+ts):
            for c in range(sc, sc+ts):
                self.grid[r][c] = "base_area"
        for r in range(sr+1, sr+ts-1):
            for c in range(sc+1, sc+ts-1):
                self.grid[r][c] = "tower_area"
        midr, midc = sr+ts//2, sc+ts//2
        self.grid[midr][midc] = "base"
        for c in range(sc, sc+ts):
            self.grid[sr][c] = "wall"
            self.grid[sr+ts-1][c] = "wall"
        for r in range(sr, sr+ts):
            self.grid[r][sc] = "wall"
            self.grid[r][sc+ts-1] = "wall"

    def _open_base_wall(self, dx, dy):
        """
        Otwiera fragment muru bazy w kierunku (dx,dy) — używane przy pierwszym rozszerzeniu.
        """
        ts = self.tile_size
        tx, ty = self.base_tile
        sr, sc = ty*ts, tx*ts
        if dx == 0 and dy == -1:
            r, c = sr, sc+ts//2
        elif dx == 0 and dy == 1:
            r, c = sr+ts-1, sc+ts//2
        elif dx == -1 and dy == 0:
            r, c = sr+ts//2, sc
        else:
            r, c = sr+ts//2, sc+ts-1
        self.grid[r][c] = "open_area"

    def _place_portal_on(self, tile, direction):
        """
        Umieszcza portal na krawędzi kafelka `tile` zgodnie z `direction` (dx,dy).
        Zapisuje pozycję w self.current_portal.
        """
        tx, ty = tile
        dx, dy = direction
        ts = self.tile_size
        sr, sc = ty*ts, tx*ts
        if dx == 0 and dy == -1:
            pr, pc = sr, sc+ts//2
        elif dx == 0 and dy == 1:
            pr, pc = sr+ts-1, sc+ts//2
        elif dx == -1 and dy == 0:
            pr, pc = sr+ts//2, sc
        else:
            pr, pc = sr+ts//2, sc+ts-1
        self.grid[pr][pc] = "portal"
        self.current_portal = (pr, pc)

    def clear_previous_portal(self):
        """Usuwa poprzedni portal (jeśli istnieje) — przywraca pole do 'open_area'."""
        if self.current_portal:
            pr, pc = self.current_portal
            if self.grid[pr][pc] == "portal":
                self.grid[pr][pc] = "open_area"
            self.current_portal = None

    def get_allowed_expansion_tiles(self):
        """
        Zwraca listę kafelków (tx,ty) które można rozszerzyć.
        Mechanizm BFS szuka najbliższych nieaktywnych kafelków od latest_tile.
        """
        if not self.first_tile_placed:
            return [(tx, ty)
                    for tx in range(self.num_tiles)
                    for ty in range(self.num_tiles)]
        dirs = [(0, 1), (1, 0), (0, -1), (-1, 0)]
        visited = {self.latest_tile}
        q = deque([(self.latest_tile, 0)])
        candidates = []
        min_dist = None
        while q:
            (tx, ty), dist = q.popleft()
            if min_dist is not None and dist > min_dist:
                break
            for dx, dy in dirs:
                nx, ny = tx+dx, ty+dy
                if not (0 <= nx < self.num_tiles and 0 <= ny < self.num_tiles):
                    continue
                if (nx, ny) in visited:
                    continue
                visited.add((nx, ny))
                if (nx, ny) not in self.active_tiles:
                    if min_dist is None:
                        min_dist = dist+1
                    if dist+1 == min_dist:
                        candidates.append((nx, ny))
                else:
                    q.append(((nx, ny), dist+1))
        return candidates

    def manual_expand_tile(self, tx, ty):
        """
        Rozszerza planszę o kafelek (tx,ty) jeśli dozwolone.
        Przy pierwszym umieszczeniu ustawia bazę i portal.
        """
        allowed = self.get_allowed_expansion_tiles()
        if (tx, ty) not in allowed:
            return False
        if not self.first_tile_placed:
            self.base_tile = (tx, ty)
            self.init_base_at(tx, ty)
            self.activate_tile(tx, ty)
            if self._bg_candidates:
                self.bg_image = random.choice(self._bg_candidates)
            self.first_tile_placed = True
            self.latest_tile = (tx, ty)
            return True
        prev_tx, prev_ty = self.latest_tile
        self.activate_tile(tx, ty)
        dx, dy = tx-prev_tx, ty-prev_ty
        if (prev_tx, prev_ty) == self.base_tile:
            self._open_base_wall(dx, dy)
        self.clear_previous_portal()
        self._place_portal_on((tx, ty), (dx, dy))
        self.latest_tile = (tx, ty)
        return True

    # -----------------------
    # BUDOWANIE W OBOZIE (camp)
    # -----------------------
    def build_in_camp(self, r, c, typ):
        """
        Buduje budynek w obozie. Zwraca True/False.
        Obsługuje natychmiastowe efekty (peasants, unemployed) i koszt w bezrobotnych.
        """
        if (r, c) not in self.camp:
            return False
        if (r, c) in self.camp_buildings:
            return False

        # natychmiastowe efekty przy postawieniu domu i posiadłości
        if typ == "house":
            self.peasants += 2
            self.unemployed += 2
        elif typ == "mansion":
            self.peasants += 4
            self.unemployed += 4
            self._mansion_placed_wave = self.wave

        # określamy koszt w bezrobotnych:
        if typ in ("house", "mansion"):
            cost = 0
        elif typ == "farm":
            cost = 1
        else:
            cost = 2  # tartak, kopalnia, huta, kopalnia diamentów

        # sprawdzamy czy mamy wystarczająco bezrobotnych
        if cost > self.unemployed:
            return False

        # pobieramy koszt
        self.unemployed -= cost

        # rejestrujemy budynek
        self.camp_buildings[(r, c)] = typ
        return True

    # -----------------------
    # BUDOWANIE STRUKTUR NA MAPIE (mury, wieże)
    # -----------------------
    def place_structure(self, typ, r, c):
        """
        Stawia mur lub wieżę, pobierając złoto. Zwraca True jeśli udało się postawić.
        """
        cell = self.grid[r][c]
        if cell in ("base", "portal"):
            return False

        # sprawdź czy mamy wystarczająco złota
        spec = STRUCTURE_BASE.get(typ)
        if not spec or self.gold < spec.cost:
            return False

        existing = self.structures.get((r, c))

        # Mur
        if typ == "wall":
            if cell not in ("open_area", "tower_area") or existing:
                return False
            # pobierz koszt
            self.gold -= spec.cost
            self.structures[(r, c)] = "wall"
            return True

        # Wieża
        assert typ.startswith("tower"), "Nieznany typ struktury"
        # jeżeli na polu jest ściana, usuwamy ją
        if existing == "wall":
            del self.structures[(r, c)]
        # ponownie sprawdź czy można
        cell = self.grid[r][c]
        if cell not in ("open_area", "tower_area") or (r, c) in self.structures:
            return False

        # pobierz koszt i stawiamy wieżę
        self.gold -= spec.cost
        self.structures[(r, c)] = typ
        return True

    # -----------------------
    # Fale i wrogowie: zarządzanie, spawn, zgon
    # -----------------------
    def _count_for_wave(self, w):
        """Pomocniczo: ile przeciwników powinno być w fali `w`."""
        if not w or w < 1:
            return 0
        stages = (w - 1) // 2
        return 2 ** stages

    def start_wave(self):
        """Rozpoczyna nową falę: inicjalizuje liczniki spawnow i czas fali."""
        self.wave += 1
        self.wave_active = True
        self.wave_start_time = time.time()
        self._hp_before_wave = self.hp

        # ile przeciwników będzie w tej fali i zresetuj licznik spawnów
        self._expected_enemies = self._count_for_wave(self.wave)
        self._spawned_in_wave = 0

        # active_enemies będzie aktualizowane przez endpointy klienta
        self.active_enemies = 0

    def enemy_spawned(self, n=1):
        """
        Zgłoszenie, że n wrogów zostało stworzonych (używane przez endpoint /api/enemy_spawn).
        Zwraca aktualną liczbę aktywnych wrogów.
        """
        try:
            n = int(n)
        except Exception:
            n = 1
        n = max(0, n)

        # ile już spawnęliśmy w tej fali
        self._spawned_in_wave += n

        # faktycznie żywi przeciwnicy na serwerze
        self.active_enemies += n

        return self.active_enemies

    def enemy_killed(self, n=1, reached_base=False, enemy_hp=1):
        """
        Zgłoszenie, że n wrogów zostało zabitych lub dotarło do bazy.
        Aktualizuje gold/hp i kończy falę gdy odpowiednie warunki spełnione.
        """
        try:
            dec = int(n)
            if dec < 0:
                dec = 1
        except Exception:
            dec = 1

        # zmniejsz liczbę aktywnych
        self.active_enemies = max(0, getattr(self, "active_enemies", 0) - dec)

        if reached_base:
            try:
                hp_val = int(enemy_hp)
                if hp_val < 1:
                    hp_val = 1
            except Exception:
                hp_val = 1
            dmg_per = (hp_val + 1) // 2
            total_dmg = dmg_per * dec
            self.hp = max(0, self.hp - total_dmg)
        else:
            self.gold += dec

        # zakończ falę tylko gdy:
        #  - brak żywych przeciwników oraz
        #  - wszystkie spodziewane spawny już się pojawiły (spawned_in_wave >= expected)
        if getattr(self, "wave_active", False):
            expected = getattr(self, "_expected_enemies", None)
            spawned = getattr(self, "_spawned_in_wave", 0)
            if self.active_enemies == 0 and (expected is None or spawned >= expected):
                # daj nagrodę i zakończ
                self.gold += 10
                try:
                    self.end_wave()
                except Exception:
                    self.wave_active = False
                    self.wave_start_time = None

    def end_wave(self):
        """
        Zakończenie fali: naliczenie czasu, obliczenie przychodów (food, surowce),
        aktualizacja zasobów i income.
        """
        # 0) czas
        if self.wave_active and self.wave_start_time:
            self.elapsed_time += int(time.time() - self.wave_start_time)
        self.wave_active = False
        self.wave_start_time = None

        # 1) reset przychodów
        for k in self.income:
            self.income[k] = 0

        cnt = list(self.camp_buildings.values()).count

        # 2) obliczamy zmianę żywności (farmy vs konsumcja)
        farm_count = cnt("farm")
        # każda farma produkuje 4 żywności,
        # konsumują wszyscy peasants poza tymi na farmach
        food_inc = 4 * farm_count - max(0, self.peasants - farm_count)

        # 3) sprawdzamy, czy po tej zmianie food >= 0
        can_prod = (self.food + food_inc) >= 0

        # 4) aktualizujemy stan żywności i income
        self.food += food_inc
        self.income["food"] += food_inc

        # 5) produkcja surowców tylko gdy can_prod==True
        if can_prod:
            # 5a) kopalnia rudy i kamienia
            ore = cnt("iron_mine")
            stone = 2 * cnt("quarry") + ore
            self.resources["iron_ore"] += ore
            self.resources["stone"] += stone
            self.income["iron_ore"] += ore
            self.income["stone"] += stone

            # 5b) tartak → drewno
            wood = 2 * cnt("sawmill")
            self.resources["wood"] += wood
            self.income["wood"] += wood

            # 5c) huta żelaza (priorytet)
            sm = cnt("smelter")
            # każdy piece zamienia jedną rudę i jedno drewno
            bars = min(sm, self.resources["iron_ore"], self.resources["wood"])
            self.resources["iron_ore"] -= bars
            self.resources["wood"] -= bars
            self.resources["iron_bar"] += bars
            # huta „cofa” te koszty w przychodach
            self.income["iron_ore"] -= bars
            self.income["wood"] -= bars
            self.income["iron_bar"] += bars

            # 5d) diamenty i złoto na zmianę co falę
            mines = cnt("diamond_mine")
            if mines:
                if self.wave % 2 == 0:
                    # parzyste fale: diamenty
                    self.resources["diamond"] += mines
                    self.income["diamond"] += mines
                else:
                    # nieparzyste fale: 3 złota z każdej kopalni
                    gold_gain = 3 * mines
                    self.gold += gold_gain
                    # nie zapisywujemy tego w income, bo nie chcemy pokazywać w income

    # -----------------------
    # EKSPORT STANU / HELPERY DLA FRONTENDU
    # -----------------------
    def get_layout(self):
        """
        Zwraca serializowalny layout/planszę do frontendu (stan gry, kafelki, struktury, zasoby).
        Oblicza przewidywane przychody tak, jak zrobiłby to end_wave.
        """
        cnt = list(self.camp_buildings.values()).count

        # przewidywany income (taki sam jak end_wave obliczyłby)
        farm_count = cnt("farm")
        food_inc = 4*farm_count - max(0, self.peasants - farm_count)
        can_prod = ((self.food + food_inc) >= 0)

        ore_inc = cnt("iron_mine") if can_prod else 0
        stone_inc = (2*cnt("quarry") + ore_inc) if can_prod else 0
        wood_inc = 2*cnt("sawmill") if can_prod else 0
        bar_inc = min(cnt("smelter"),
                        self.resources["iron_ore"]+ore_inc,
                        self.resources["wood"]+wood_inc) if can_prod else 0
        dia_inc = cnt("diamond_mine") if (can_prod and self.wave % 2 == 0) else 0

        incomes = {
            "wood":      wood_inc - bar_inc,
            "stone":     stone_inc,
            "iron_ore":  ore_inc - bar_inc,
            "iron_bar":  bar_inc,
            "diamond":   dia_inc,
            "food":      food_inc
        }

        return {
            "grid2d":        self.grid,
            "separator_y":   self.separator_y,
            "total_rows":    self.total_rows,
            "total_cols":    self.total_cols,
            "tile_size":     self.tile_size,
            "num_tiles":     self.num_tiles,
            "bg_image":      self.bg_image,
            "camp": [
                {"x": c, "y": r,
                 "t": self.camp[(r, c)],
                 "b": (r, c) in self.camp_buildings,
                 "bt": self.camp_buildings.get((r, c))}
                for (r, c) in sorted(self.camp)
            ],
            "allowed_tiles":
                [{"tx": tx, "ty": ty}
                             for tx, ty in self.get_allowed_expansion_tiles()],
            "structures":
                [{"x": c, "y": r, "t": t}
                          for (r, c), t in self.structures.items()],
            "first_tile_placed": self.first_tile_placed,
            "hp":            self.hp,
            "gold":          self.gold,
            "wave":          self.wave,
            "wave_active": self.wave_active,
            "active_enemies": getattr(self, "active_enemies", 0),
            "time":          self.elapsed_time + (int(time.time()-self.wave_start_time) if self.wave_active else 0),
            "resources":     self.resources,
            "peasants":      self.peasants,
            "unemployed":    self.unemployed,
            "food":          self.food,
            "income":        incomes,
        }
