# app.py

import logging
import time
from flask import Flask, render_template, jsonify, request
from game_logic import Board
import tower_logic
from tower_logic import STRUCTURE_BASE

# wyciszamy logi serwera Werkzeug
logging.getLogger('werkzeug').setLevel(logging.ERROR)

app = Flask(__name__)
board = Board()


@app.route("/")
def index():
    # render głównego widoku gry
    return render_template("index.html", board=board.get_layout())


@app.route("/api/state", methods=["GET"])
def api_state():
    # aktualny stan planszy
    return jsonify(board.get_layout())


@app.route("/api/expand", methods=["POST"])
def expand():
    # ręczne rozszerzanie pola
    data = request.get_json()
    tx = data.get("tx")
    ty = data.get("ty")
    ok = board.manual_expand_tile(tx, ty)
    return jsonify({"ok": ok})


@app.route("/api/build", methods=["POST"])
def build_main():
    # budowa struktur (wieża, mur)
    data = request.get_json()
    typ = data.get("type")
    x = data.get("x")
    y = data.get("y")

    if typ is None or x is None or y is None:
        return jsonify({"ok": False, "error": "Niepełne dane"}), 400

    r, c = int(y), int(x)

    # blokada budowy na bazie i portalu
    if board.grid[r][c] in ("base", "portal"):
        return jsonify({"ok": False, "error": "Nie można budować na bazie ani portalu"}), 400

    spec = STRUCTURE_BASE.get(typ)
    if not spec:
        return jsonify({"ok": False, "error": "Nieznany typ struktury"}), 400
    if board.gold < spec.cost:
        return jsonify({"ok": False, "error": "Brakuje złota"}), 400

    cell_type = board.grid[r][c]
    existing = board.structures.get((r, c))

    if typ == "wall":
        # mur tylko na pustych polach przeznaczonych pod budowę
        if cell_type not in ("open_area", "tower_area") or existing:
            return jsonify({"ok": False, "error": "Nie można postawić muru tutaj"}), 400
    else:
        # sprawdzenie wieży
        if not typ.startswith("tower"):
            return jsonify({"ok": False, "error": "Nieznany typ struktury"}), 400
        if existing and not (existing == "wall"):
            return jsonify({"ok": False, "error": "Miejsce zajęte"}), 400
        if cell_type not in ("open_area", "tower_area"):
            return jsonify({"ok": False, "error": "Nie można postawić wieży na tym polu"}), 400

    orig = board.structures.get((r, c), None)
    try:
        # wstawienie struktury tymczasowo
        if typ == "wall":
            board.structures[(r, c)] = "wall"
        else:
            if orig == "wall":
                del board.structures[(r, c)]
            board.structures[(r, c)] = typ

        from pathfinding import find_shortest_path

        # sprawdzanie czy nie blokuje drogi
        if not board.first_tile_placed or board.base_tile is None or board.current_portal is None:
            if orig is None:
                board.structures.pop((r, c), None)
            else:
                board.structures[(r, c)] = orig
            ok = board.place_structure(typ, r, c)
            if ok:
                return jsonify({"ok": True})
            else:
                return jsonify({"ok": False, "error": "Brakuje złota lub niewłaściwe miejsce"}), 400

        portal = board.current_portal
        blocked = set(board.structures.keys())
        path = find_shortest_path(board.grid, portal, None, blocked=blocked)

        if not path:
            # cofnięcie budowy jeśli blokuje drogę
            if orig is None:
                board.structures.pop((r, c), None)
            else:
                board.structures[(r, c)] = orig
            return jsonify({"ok": False, "error": "Budowa zablokuje drogę!"}), 400

        if orig is None:
            board.structures.pop((r, c), None)
        else:
            board.structures[(r, c)] = orig

        # finalne postawienie struktury
        ok = board.place_structure(typ, r, c)
        if ok:
            return jsonify({"ok": True})
        else:
            return jsonify({"ok": False, "error": "Brakuje złota lub niewłaściwe miejsce"}), 400

    except Exception:
        # awaryjne przywrócenie stanu
        if orig is None:
            board.structures.pop((r, c), None)
        else:
            board.structures[(r, c)] = orig
        return jsonify({"ok": False, "error": "Błąd serwera podczas budowy"}), 500


@app.route("/api/build_camp", methods=["POST"])
def build_camp():
    # budowanie struktur w obozie
    data = request.get_json()
    x = data.get("x")
    y = data.get("y")
    typ = data.get("type")
    ok = board.build_in_camp(y, x, typ)
    return jsonify({"ok": ok})


@app.route("/api/start_wave", methods=["POST"])
def start_wave():
    # rozpoczęcie fali
    board.start_wave()
    return jsonify({"ok": True})


@app.route("/api/end_wave", methods=["POST"])
def end_wave_manual():
    # ręczne zakończenie fali
    board.end_wave()
    return jsonify({"ok": True})


@app.route("/api/enemy_spawn", methods=["POST"])
def api_enemy_spawn():
    # zgłoszenie spawnu przeciwnika
    data = request.get_json() or {}
    cnt = data.get("count", 1)
    try:
        cnt = int(cnt)
    except Exception:
        cnt = 1
    if hasattr(board, "enemy_spawned"):
        board.enemy_spawned(cnt)
    return jsonify({"ok": True, "active_enemies": getattr(board, "active_enemies", 0)})


@app.route("/api/enemy_die", methods=["POST"])
def api_enemy_die():
    # zgłoszenie śmierci przeciwnika
    data = request.get_json() or {}
    cnt = data.get("count", 1)
    try:
        cnt = int(cnt)
    except Exception:
        cnt = 1

    # czy przeciwnik dotarł do bazy
    reached = bool(data.get("reached_base", False))

    # ile HP miał przeciwnik przy śmierci
    try:
        hp = int(data.get("hp", 1))
    except Exception:
        hp = 1

    if hasattr(board, "enemy_killed"):
        try:
            # aktualna wersja: tylko podstawowe parametry
            board.enemy_killed(cnt, reached_base=reached, enemy_hp=hp)
        except TypeError:
            # fallback na starszą sygnaturę
            board.enemy_killed(cnt)

    return jsonify({
        "ok": True,
        "active_enemies": getattr(board, "active_enemies", 0),
        "gold": getattr(board, "gold", 0),
        "hp": getattr(board, "hp", 0)
    })


@app.route("/api/upgrade", methods=["POST"])
def api_upgrade():
    # kupno ulepszenia wieży
    data = request.get_json()
    tt = data.get("tower_type")
    cat = data.get("category")
    idx = data.get("upgrade_index")
    ok = tower_logic.do_upgrade(board, tt, cat, idx)
    if ok:
        return jsonify({"ok": True})
    else:
        return jsonify({"ok": False, "error": "Nie można kupić ulepszenia"}), 400


@app.route("/api/path", methods=["GET"])
def api_path():
    # podgląd ścieżki od portalu do bazy
    if not board.first_tile_placed or board.base_tile is None or board.current_portal is None:
        return jsonify({"path": []})
    pr, pc = board.current_portal
    from pathfinding import find_shortest_path
    blocked = set(board.structures.keys())
    path = find_shortest_path(board.grid, (pr, pc), None, blocked=blocked)
    return jsonify({"path": path})


@app.route("/api/tower_specs", methods=["GET"])
def api_tower_specs():
    # zwraca wszystkie specyfikacje wież
    specs = tower_logic.get_all_tower_specs()
    return jsonify(specs)


@app.route("/api/debug_add", methods=["POST"])
def api_debug_add():
    # debug: dodawanie surowców lub hp
    data = request.get_json() or {}
    res_type = data.get("type")
    try:
        amount = int(data.get("amount", 0))
    except Exception:
        amount = 0

    new_val = None
    if res_type in ("hp", "gold", "food"):
        setattr(board, res_type, getattr(board, res_type, 0) + amount)
        new_val = getattr(board, res_type, 0)
    elif isinstance(getattr(board, "resources", None), dict) and res_type in board.resources:
        board.resources[res_type] = board.resources.get(res_type, 0) + amount
        new_val = board.resources[res_type]

    return jsonify({"ok": True, "type": res_type, "value": new_val})


@app.route("/api/debug_tower_buffs", methods=["POST"])
def api_debug_tower_buffs():
    # debug: sztuczne buffy dla wszystkich wież
    data = request.get_json() or {}
    enabled = bool(data.get("enabled", False))
    for t in getattr(board, "towers", []):
        if enabled:
            t.range += 5
            t.damage += 10
            t.speed += 5
        else:
            t.range -= 5
            t.damage -= 10
            t.speed -= 5
    return jsonify({"ok": True, "buffs": enabled})


if __name__ == "__main__":
    # start serwera aplikacji
    app.run(debug=True)
