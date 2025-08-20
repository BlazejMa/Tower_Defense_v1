# tower_logic.py
import time
from math import hypot
from collections import namedtuple

# przełącznik debugowania (można ustawić z menu debugowania)
debug_tower_buffs_enabled = False

# -- baza struktur --
StructureSpecs = namedtuple("StructureSpecs", ["cost", "base_range", "base_speed", "base_damage"])
STRUCTURE_BASE = {
    "wall":    StructureSpecs(5,  0,   0.0, 0.0),
    "tower1":  StructureSpecs(10, 1,   1.0, 1.0),
    "tower2":  StructureSpecs(25, 2,   1.0, 1.5),
    "tower3":  StructureSpecs(25, 1,   0.5, 3.0),
    "tower4":  StructureSpecs(50, 2,   0.5, 4.0),
    "tower5":  StructureSpecs(75, 2,   1.0, 5.0),
}

# -- definicje ulepszeń (poziomy) --
# "strategic" pozostaje w definicjach (oznacza zakupione ulepszenie strategiczne),
# ale tymczasowo jego efekt = podwójny strzał.
UPGRADE_DEFS = {
    "tower1": {
        "range": [
            ({"wood": 3},                                0),
            ({"wood": 6, "stone": 3},                   +1),
        ],
        "speed": [
            ({"wood": 4, "stone": 2},                   +0.25),
            ({"stone": 8, "iron_ore": 2},               +0.25),
        ],
        "damage": [
            ({"wood": 4, "stone": 3},                   +0.25),
            ({"stone": 6, "iron_ore": 3},               +0.25),
        ],
        "strategic": [
            ({"iron_bar": 6, "diamond": 2, "food": 10}, True),
        ],
    },
    "tower2": {
        "range": [],
        "speed": [
            ({"wood": 4, "stone": 3},                   +0.15),
            ({"stone": 9, "iron_ore": 4},               +0.10),
        ],
        "damage": [
            ({"wood": 5, "stone": 4},                   +0.35),
            ({"stone": 8, "iron_ore": 5},               +0.40),
        ],
        "strategic": [
            ({"stone": 8, "iron_ore": 8, "iron_bar": 4, "diamond": 3, "food": 15}, True),
        ],
    },
    "tower3": {
        "range": [
            ({"wood": 4},                                0),
            ({"wood": 6, "stone": 4},                   +1),
        ],
        "speed": [],
        "damage": [
            ({"wood": 6, "stone": 5},                   +0.75),
            ({"stone": 10, "iron_ore": 6},              +0.75),
        ],
        "strategic": [
            ({"iron_bar": 10, "diamond": 6}, True),
        ],
    },
    "tower4": {
        "range": [
            ({"wood": 6, "stone": 6, "iron_ore": 4},     0),
            ({"wood": 8, "stone": 12, "iron_ore": 10},  +1),
        ],
        "speed": [
            ({"wood": 5, "stone": 5, "iron_ore": 4},    +0.25),
            ({"wood": 8, "stone": 10, "iron_ore": 8},   +0.25),
        ],
        "damage": [
            ({"wood": 6, "stone": 6, "iron_ore": 5},    +0.35),
            ({"wood": 8, "stone": 12, "iron_ore": 10},  +0.40),
        ],
        "strategic": [
            ({"iron_bar": 8, "diamond": 8, "food": 20}, True),
        ],
    },
    "tower5": {
        "range": [],
        "speed": [],
        "damage": [
            ({"stone": 12, "iron_bar": 6},               +2),
            ({"stone": 18, "diamond": 4},                +2),
        ],
        "strategic": [
            ({"wood": 80, "stone": 40, "iron_ore": 30, "iron_bar": 25, "diamond": 15, "food": 30}, True),
        ],
    },
}

# poziomy zakupionych ulepszeń (indeksowane od zera)
_upgrade_levels = {
    typ: {cat: 0 for cat in UPGRADE_DEFS[typ]}
    for typ in UPGRADE_DEFS
}


# -------------------------
# ZASOBY
# -------------------------
def _has_resources(board, cost):
    for res, qty in cost.items():
        if res == "food":
            if getattr(board, "food", 0) < qty:
                return False
        else:
            if board.resources.get(res, 0) < qty:
                return False
    return True


def _spend_resources(board, cost):
    for res, qty in cost.items():
        if res == "food":
            board.food -= qty
        else:
            board.resources[res] -= qty


# -------------------------
# KOSZT STRUKTURY
# -------------------------
def get_structure_cost(typ):
    base = STRUCTURE_BASE.get(typ)
    return base.cost if base else None


# -------------------------
# KLASA TOWER
# -------------------------
class Tower:
    def __init__(self, typ, row, col):
        self.typ = typ
        self.row = row
        self.col = col
        self._last_shot = 0.0

    def specs(self):
        """
        Zwraca bieżące statystyki wieży uwzględniające ulepszenia.
        """
        base = STRUCTURE_BASE[self.typ]
        lvl = _upgrade_levels.get(self.typ, {k: 0 for k in ("range", "speed", "damage", "strategic")})

        rng = base.base_range
        if "range" in lvl:
            rng += sum(eff for (_, eff) in UPGRADE_DEFS.get(self.typ, {}).get("range", [])[: lvl.get("range", 0)])

        spd = base.base_speed + sum(eff for (_, eff) in UPGRADE_DEFS.get(self.typ, {}).get("speed", [])[: lvl.get("speed", 0)])
        dmg = base.base_damage + sum(eff for (_, eff) in UPGRADE_DEFS.get(self.typ, {}).get("damage", [])[: lvl.get("damage", 0)])
        strat = lvl.get("strategic", 0) > 0

        specs = {"range": rng, "speed": spd, "damage": dmg, "strategic": strat}

        if debug_tower_buffs_enabled:
            specs["range"] += 5
            specs["damage"] += 10
            specs["speed"] += 5

        return specs

    def can_attack(self, now=None):
        spec = self.specs()
        if spec["speed"] <= 0:
            return False
        now = now or time.time()
        return (now - self._last_shot) >= 1.0 / spec["speed"]

    def attack(self, enemies, now=None, board=None):
        """
        Atakuje wrogów w zasięgu.
        Tymczasowo: każde ulepszenie strategiczne = podwójny strzał.
        """
        now = now or time.time()
        spec = self.specs()
        if not self.can_attack(now):
            return False

        in_range = [
            e for e in enemies
            if hasattr(e, "row") and hasattr(e, "col")
            and hypot(e.col - self.col, e.row - self.row) <= spec["range"]
        ]
        if not in_range:
            return False

        # podwójny strzał jeśli ulepszenie strategiczne jest aktywne
        count = 2 if spec.get("strategic", False) else 1

        in_range_sorted = sorted(in_range, key=lambda e: hypot(e.col - self.col, e.row - self.row))

        for e in in_range_sorted[:count]:
            try:
                if hasattr(e, "take_damage"):
                    e.take_damage(spec["damage"])
                elif hasattr(e, "hp"):
                    e.hp -= spec["damage"]
            except Exception:
                pass

        self._last_shot = now
        return True


# -------------------------
# API ulepszania / budowy
# -------------------------
def can_upgrade(board, tower_type, category):
    defs = UPGRADE_DEFS.get(tower_type, {})
    lvl = _upgrade_levels.get(tower_type, {}).get(category, 0)
    if category not in defs:
        return False
    if lvl >= len(defs[category]):
        return False
    cost, _ = defs[category][lvl]
    return _has_resources(board, cost)


def do_upgrade(board, tower_type, category, upgrade_index):
    lvl = _upgrade_levels.get(tower_type, {}).get(category, 0)
    if upgrade_index != lvl + 1:
        return False
    defs = UPGRADE_DEFS.get(tower_type, {})
    if category not in defs or lvl >= len(defs[category]):
        return False
    cost, _ = defs[category][lvl]
    if not _has_resources(board, cost):
        return False
    _spend_resources(board, cost)
    _upgrade_levels[tower_type][category] += 1
    return True


def get_upgrade_level(tower_type, category):
    return _upgrade_levels.get(tower_type, {}).get(category, 0)


def can_build_structure(board, typ):
    cost = get_structure_cost(typ)
    return cost is not None and getattr(board, "gold", 0) >= cost


def build_structure(board, typ, r, c):
    spec = STRUCTURE_BASE.get(typ)
    if not spec:
        return False
    cost = get_structure_cost(typ)
    if board.gold < cost:
        return False
    ok = board.place_structure(typ, r, c)
    if not ok:
        return False
    board.gold -= cost
    if typ.startswith("tower"):
        board.towers = getattr(board, "towers", [])
        board.towers.append(Tower(typ, r, c))
    return True


def process_towers(board, enemies):
    """
    Każda wieża na planszy wykonuje atak.
    """
    now = time.time()
    for tower in getattr(board, "towers", []):
        tower.attack(enemies, now=now, board=board)


# -------------------------
# HELPERY DLA FRONTENDU
# -------------------------
def get_specs_for_type(tower_type):
    base = STRUCTURE_BASE.get(tower_type)
    if base is None:
        return None
    if tower_type not in UPGRADE_DEFS:
        return {"range": base.base_range, "speed": base.base_speed, "damage": base.base_damage, "strategic": False}
    t = Tower(tower_type, 0, 0)
    return t.specs()


def get_all_tower_specs():
    out = {}
    for typ in STRUCTURE_BASE.keys():
        spec = get_specs_for_type(typ)
        if spec is not None:
            out[typ] = spec
    return out
