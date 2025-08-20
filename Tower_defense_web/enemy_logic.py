# enemy_logic.py
"""
Moduł pomocniczy dla logiki fal przeciwników.
Zawiera funkcje określające HP pojedynczego wroga dla danej fali,
liczbę przeciwników w fali oraz ustawienia czasowe (ms).
"""

from math import floor


def hp_for_wave(wave: int) -> int:
    """
    HP przeciwnika według fali.
    Fale 1-3 -> 1 HP, fale 4-6 -> 4 HP, fale 7-9 -> 7 HP, ...
    Wzór: 1 + 3 * floor((wave-1)/3)

    Parametry:
        wave: numer fali (int)

    Zwraca:
        int: HP pojedynczego przeciwnika dla danej fali
    """
    if wave is None or wave < 1:
        return 1
    return 1 + 3 * ((wave - 1) // 3)


def count_for_wave(wave: int) -> int:
    """
    Liczba przeciwników w fali.
    Zaczyna od 1 i podwaja się co 2 fale:
      fale 1-2 -> 1,
      fale 3-4 -> 2,
      fale 5-6 -> 4,
      fale 7-8 -> 8, ...
    Wzór: 2 ** floor((wave-1)/2)

    Parametry:
        wave: numer fali (int)

    Zwraca:
        int: liczba przeciwników w fali
    """
    if wave is None or wave < 1:
        return 1
    stages = (wave - 1) // 2
    return 2 ** stages


# czasy w ms (możesz zmienić)
def time_per_tile_ms() -> int:
    """
    Ile ms zajmuje przejście jednego pola (1 kratka).
    Domyślnie: 2000 ms (2 sekundy).
    """
    return 2000


def spawn_interval_ms() -> int:
    """
    Interwał pomiędzy kolejnymi spawnami w fali (w ms).
    Domyślnie: 800 ms.
    """
    return 800
