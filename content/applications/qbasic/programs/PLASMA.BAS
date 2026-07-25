' Plasma - a shaded pattern animated by cycling the palette.
' Press any key to stop.

SCREEN 13

CONST WIDE = 80
CONST HIGH = 50

' Sine lookups: the pattern is drawn in blocks of 4x4 pixels, so each table
' holds one value per block. Adding three of them is far quicker than working
' out three sines for every block.
DIM acrossd(WIDE), downd(HIGH), diagonal(WIDE + HIGH)

FOR i = 0 TO WIDE: acrossd(i) = SIN(i * 4 / 24): NEXT i
FOR i = 0 TO HIGH: downd(i) = SIN(i * 4 / 18): NEXT i
FOR i = 0 TO WIDE + HIGH: diagonal(i) = SIN(i * 4 / 30): NEXT i

GOSUB SetPalette

' draw the pattern once; only the palette moves afterwards
FOR j = 0 TO HIGH - 1
    FOR i = 0 TO WIDE - 1
        v = acrossd(i) + downd(j) + diagonal(i + j)
        shade = INT((v + 3) * 10.5)
        IF shade > 63 THEN shade = 63
        IF shade < 0 THEN shade = 0
        LINE (i * 4, j * 4)-(i * 4 + 3, j * 4 + 3), 64 + shade, BF
    NEXT i
    IF INKEY$ <> "" THEN GOTO Finished
NEXT j

DO
    ' roll the colour ramp round by one step
    shift = (shift + 1) MOD 64
    GOSUB SetPalette
LOOP WHILE INKEY$ = ""

Finished:
SCREEN 0
END

SetPalette:
' a ramp from blue through green to red, offset by shift
FOR i = 0 TO 63
    j = (i + shift) MOD 64
    PALETTE 64 + i, j + ABS(32 - j) * 256& + (63 - j) * 65536&
NEXT i
RETURN
