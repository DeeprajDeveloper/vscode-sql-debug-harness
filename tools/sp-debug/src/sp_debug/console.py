"""Terminal styling helpers for CLI output."""

from __future__ import annotations

import os
import sys

RESET = "\033[0m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
BOLD = "\033[1m"
ITALIC = "\033[3m"
DIM = "\033[2m"


def supports_color() -> bool:
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def style(text: str, color: str, *, enabled: bool = True) -> str:
    if not enabled:
        return text
    return f"{color}{text}{RESET}"


def success(text: str, *, enabled: bool = True) -> str:
    return style(text, GREEN, enabled=enabled)


def failure(text: str, *, enabled: bool = True) -> str:
    return style(text, RED, enabled=enabled)


def warning(text: str, *, enabled: bool = True) -> str:
    return style(text, YELLOW, enabled=enabled)


def heading(text: str, *, enabled: bool = True) -> str:
    return style(text, CYAN + BOLD, enabled=enabled)


def dim(text: str, *, enabled: bool = True) -> str:
    return style(text, DIM, enabled=enabled)
