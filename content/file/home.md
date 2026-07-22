---
title: clacktronics.co.uk
style: page
tagline: Hardware for people who fail to read the datasheet twice.
---
# Clacktronics

[Open in OpenSCAD](app:applications/openscad.html?code=%24fa%3D1%3B%0D%0A%24fs%3D0.5%3B%0D%0A%0D%0Adifference()%20%7B%0D%0A%20%20cylinder(d%3D30%2C%20h%3D5%2C%20center%3Dtrue)%3B%0D%0A%20%20cylinder(d%3D25%2C%20h%3D6%2C%20center%3Dtrue)%3B%0D%0A%7D%0D%0A%0D%0Adifference()%20%7B%0D%0A%20%20cylinder(d%3D15%2C%20h%3D5%2C%20center%3Dtrue)%3B%0D%0A%20%20cylinder(d%3D10%2C%20h%3D6%2C%20center%3Dtrue)%3B%0D%0A%7D%0D%0A%0D%0Afor(t%3D%5B0%3A30%3A369%5D)%0D%0A%20%20rotate(%5B0%2C0%2Ct%5D)%0D%0A%20%20%20%20translate(%5B10%2C0%2C0%5D)%0D%0A%20%20%20%20%20%20sphere(d%3D5%2C%20center%3Dtrue)%3B&render=1)

Clacktronics designs and builds open, hackable electronics from a small workshop in the north of England. We make Eurorack modules, development boards and firmware libraries built around the RP2350 — machines that do one thing well and tell you exactly how they do it.

Every board ships with schematics, source code and a written explanation of the design decisions. No black boxes. No cloud accounts. If it stops working, you can fix it — and we'll show you how.

## // What we make

1. **EuroClack Green Screen 2350.** A dual-board Eurorack module with a real display, CV in and out, USB host, and dual-core headroom to spare. Sequence, visualise, misuse.

## // Why monochrome

Because constraints are clarifying. A 1-bit screen forces every pixel to justify itself, and we think documentation should work the same way. This site contains no tracking, no scripts it doesn't need, and nothing that won't render on a machine from 1984 — in spirit, at least.

[Browse the catalogue](window:file/catalogue.md)
[Read the docs](window:file/readme.md)


