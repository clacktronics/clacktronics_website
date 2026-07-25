' Starfield - stars streaming past, as if flying through them.
' Press any key to stop.

SCREEN 13
RANDOMIZE TIMER

CONST COUNT = 120

DIM sx(COUNT), sy(COUNT), sz(COUNT)

FOR i = 1 TO COUNT
    sx(i) = RND * 320 - 160
    sy(i) = RND * 200 - 100
    sz(i) = RND * 64 + 1
NEXT i

DO
    FOR i = 1 TO COUNT
        ' project the star onto the screen, seen from the middle
        px = 160 + sx(i) * 32 / sz(i)
        py = 100 + sy(i) * 32 / sz(i)
        IF px >= 0 AND px <= 319 AND py >= 0 AND py <= 199 THEN PSET (px, py), 0

        sz(i) = sz(i) - 1
        IF sz(i) < 1 THEN
            sx(i) = RND * 320 - 160
            sy(i) = RND * 200 - 100
            sz(i) = 64
        END IF

        px = 160 + sx(i) * 32 / sz(i)
        py = 100 + sy(i) * 32 / sz(i)
        IF px >= 0 AND px <= 319 AND py >= 0 AND py <= 199 THEN
            ' near stars are brighter than far ones: 16 to 31 is a grey ramp
            PSET (px, py), 16 + INT((64 - sz(i)) / 4.3)
        END IF
    NEXT i

    FOR pause = 1 TO 200: NEXT pause
LOOP WHILE INKEY$ = ""

SCREEN 0
END
