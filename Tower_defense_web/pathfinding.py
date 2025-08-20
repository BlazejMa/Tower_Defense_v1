# pathfinding.py

from collections import deque


def find_shortest_path(grid, start, end=None, blocked=None):
    """
    BFS zwraca najkrótszą ścieżkę jako listę [ [r,c], ... ].
    - grid: lista list (grid[r][c] = typ pola)
    - start: (r,c) start (portal)
    - end: opcjonalnie (r,c). Jeśli None albo nieprawidłowe -> szukamy komórki "base"
    - blocked: optional iterable krotek (r,c) traktowanych jako zablokowane (np. board.structures.keys())
    Zwraca [] gdy brak ścieżki.
    """
    if blocked is None:
        blocked = set()
    else:
        # normalizacja do set((r,c),...)
        try:
            blocked = set((int(x[0]), int(x[1])) for x in blocked)
        except Exception:
            try:
                blocked = set(blocked)
            except Exception:
                blocked = set()

    rows = len(grid)
    if rows == 0:
        return []
    cols = len(grid[0])

    # waliduj start
    if not (isinstance(start, (list, tuple)) and 0 <= start[0] < rows and 0 <= start[1] < cols):
        return []
    sr, sc = int(start[0]), int(start[1])

    # ustal cel: end jeśli poprawny, inaczej szukamy "base" w grid
    if end is not None and isinstance(end, (list, tuple)) and 0 <= end[0] < rows and 0 <= end[1] < cols:
        er, ec = int(end[0]), int(end[1])
    else:
        er = ec = None
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == "base":
                    er, ec = r, c
                    break
            if er is not None:
                break
        if er is None:
            return []

    def walkable(r, c):
        if not (0 <= r < rows and 0 <= c < cols):
            return False
        # "void" i "wall" są nieprzechodnie
        if grid[r][c] == "void" or grid[r][c] == "wall":
            return False
        # pola z strukturami (blocked) traktujemy jako nieprzechodnie
        if (r, c) in blocked:
            return False
        # dopuszczalne typy
        return grid[r][c] in ("open_area", "tower_area", "base_area", "base", "portal")

    q = deque()
    q.append((sr, sc))
    prev = {(sr, sc): None}
    dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    while q:
        r, c = q.popleft()
        if (r, c) == (er, ec):
            break
        for dr, dc in dirs:
            nr, nc = r + dr, c + dc
            if (nr, nc) not in prev and walkable(nr, nc):
                prev[(nr, nc)] = (r, c)
                q.append((nr, nc))

    if (er, ec) not in prev:
        return []

    # odtwórz ścieżkę
    path = []
    cur = (er, ec)
    while cur is not None:
        path.append([cur[0], cur[1]])
        cur = prev[cur]
    path.reverse()
    return path
