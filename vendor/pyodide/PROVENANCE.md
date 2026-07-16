# Pyodide (vendored)

Unmodified core runtime files from the `pyodide` npm package v314.0.2
(https://pyodide.org, MPL-2.0 — see LICENSE-MPL-2.0.txt; CPython inside
is PSF-licensed). Used by content/applications/python.html.

Only the core interpreter is vendored. Installing extra packages at
runtime (micropip) fetches wheels from PyPI over the network.

To update: replace these files with the current npm package's dist.
