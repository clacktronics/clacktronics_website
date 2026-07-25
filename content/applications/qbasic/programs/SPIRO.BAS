' Spirograph - curves traced by a circle rolling inside another one.
' Press any key to stop.

SCREEN 12
RANDOMIZE TIMER

done = 0

DO
    CLS
    big = INT(RND * 120) + 100
    small = INT(RND * 60) + 20
    arm = INT(RND * 40) + 20
    colour = INT(RND * 15) + 1
    ratio = (big - small) / small

    FOR t = 0 TO 100 STEP .02
        x = 320 + (big - small) * COS(t) + arm * COS(ratio * t)
        y = 240 + (big - small) * SIN(t) - arm * SIN(ratio * t)
        PSET (x, y), colour
        IF INKEY$ <> "" THEN done = 1: EXIT FOR
    NEXT t

    ' hold the finished figure for a moment
    start! = TIMER
    DO WHILE TIMER - start! < 2 AND done = 0
        IF INKEY$ <> "" THEN done = 1
    LOOP
LOOP UNTIL done = 1

SCREEN 0
END
