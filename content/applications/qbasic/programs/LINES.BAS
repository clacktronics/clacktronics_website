' Random Lines - coloured lines drawn at random, clearing when full.
' Press any key to stop.

SCREEN 12
RANDOMIZE TIMER

drawn = 0

DO
    x1 = INT(RND * 640): y1 = INT(RND * 480)
    x2 = INT(RND * 640): y2 = INT(RND * 480)
    LINE (x1, y1)-(x2, y2), INT(RND * 15) + 1

    drawn = drawn + 1
    IF drawn > 250 THEN
        CLS
        drawn = 0
    END IF

    FOR pause = 1 TO 400: NEXT pause
LOOP WHILE INKEY$ = ""

SCREEN 0
END
