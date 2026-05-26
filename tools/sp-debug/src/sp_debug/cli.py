"""CLI for sp-debug."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import typer

from sp_debug import __version__
from sp_debug.console import supports_color
from sp_debug.inventory import inventory_from_sql
from sp_debug.transform import transform_sql

APP_HELP = """
Transform MSSQL stored procedures into debug-safe harness scripts.

\b
Commands:
  inventory   Parse a script and report structural elements (DML, TRY/CATCH, variables)
  transform   Generate a debug harness with stubbed DML and variable traces

\b
Quick start:
  sp-debug inventory -i samples/my_proc.sql
  sp-debug transform -i samples/my_proc.sql -o samples/my_proc_debug.sql

\b
More help:
  sp-debug inventory --help
  sp-debug transform --help
"""

app = typer.Typer(
    name="sp-debug",
    help=APP_HELP,
    no_args_is_help=True,
    add_completion=False,
)


@app.command("version")
def cmd_version() -> None:
    """Print package version."""
    typer.echo(__version__)


def _version() -> str:
    try:
        from importlib.metadata import version

        return version("sp-debug")
    except Exception:
        return "0.1.0"


@app.callback()
def main(
    ctx: typer.Context,
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        "-V",
        help="Show version and exit.",
        is_eager=True,
    ),
) -> None:
    """MSSQL stored procedure debug harness generator."""
    if version:
        typer.echo(f"sp-debug {_version()}")
        raise typer.Exit()


def _read_input(path: Optional[Path]) -> str:
    if path is None or str(path) == "-":
        return sys.stdin.read()
    return path.read_text(encoding="utf-8")


def _write_output(path: Optional[Path], content: str) -> None:
    if path is None or str(path) == "-":
        sys.stdout.write(content)
        return
    path.write_text(content, encoding="utf-8")


@app.command("inventory")
def inventory_cmd(
    input: Path = typer.Option(
        ...,
        "--input",
        "-i",
        help="Input .sql file (use - for stdin).",
    ),
    report: Optional[Path] = typer.Option(
        None,
        "--report",
        "-r",
        help="Write plain-text report to file (no ANSI colors).",
    ),
    plain: bool = typer.Option(
        False,
        "--plain",
        help="Disable ANSI colors on terminal output.",
    ),
    full: bool = typer.Option(
        False,
        "--full",
        help="Show all sections, including zero counts.",
    ),
) -> None:
    """
    Parse a T-SQL script and print a structural inventory.

    By default only non-zero sections are shown, with green counts and red zeros.
    Use --full to list every section; use --plain to disable colors.
    """
    sql = _read_input(input)
    inv = inventory_from_sql(sql)
    colorize = supports_color() and not plain and report is None
    text = inv.to_text(colorize=colorize, non_zero_only=not full)
    if report:
        report.write_text(text + "\n", encoding="utf-8")
        typer.echo(f"Inventory written to {report}")
    else:
        typer.echo(text)


@app.command("transform")
def transform_cmd(
    input: Path = typer.Option(
        ...,
        "--input",
        "-i",
        help="Input .sql file (use - for stdin).",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="Output path (default: <input>_debug.sql).",
    ),
    trace_style: str = typer.Option(
        "print",
        "--trace-style",
        help="Trace style: print (default) or raiserror (NOWAIT).",
    ),
    no_stub_dml: bool = typer.Option(
        False, "--no-stub-dml", help="Skip DML stubbing; only add traces."
    ),
    block_markers: bool = typer.Option(
        False,
        "--block-markers",
        help="Insert -- [DBG] Step N markers before IF/WHILE.",
    ),
    quiet: bool = typer.Option(
        False,
        "--quiet",
        "-q",
        help="Suppress progress messages on stderr.",
    ),
) -> None:
    """
    Generate a debug harness script from a stored procedure.

    Stubs INSERT/UPDATE/DELETE/MERGE against real tables and injects variable
    traces after SET and SELECT assignments.
    """
    if trace_style not in ("raiserror", "print"):
        typer.echo("trace-style must be 'raiserror' or 'print'", err=True)
        raise typer.Exit(1)

    sql = _read_input(input)
    progress = None if quiet else lambda msg: typer.echo(msg, err=True)

    result = transform_sql(
        sql,
        trace_style=trace_style,
        stub_dml=not no_stub_dml,
        add_block_markers=block_markers,
        on_progress=progress,
    )

    out_path = output
    if out_path is None and str(input) != "-":
        out_path = input.with_name(f"{input.stem}_debug{input.suffix}")

    _write_output(out_path, result.sql)

    summary = (
        f"Done: {result.stats.dml_stubbed} DML stubbed, "
        f"{result.stats.traces_added} traces added."
    )
    if out_path and str(out_path) != "-":
        typer.echo(f"{summary} Written to {out_path}")
    else:
        typer.echo(summary)

    if result.parse_errors:
        typer.echo("Parse warnings present — review banner in output.", err=True)
        raise typer.Exit(2)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
