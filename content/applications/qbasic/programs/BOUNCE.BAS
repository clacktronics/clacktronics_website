' Bouncing Ball - a ball ricocheting around the screen.
' Press any key to stop.

SCREEN 12
RANDOMIZE TIMER

x = 320: y = 240
dx = 4: dy = 3
r = 14
colour = 10

DO
    ' rub the ball out, move it, draw it again
    CIRCLE (x, y), r, 0
    PAINT (x, y), 0, 0

    x = x + dx
    y = y + dy

    IF x - r <= 0 OR x + r >= 639 THEN
        dx = -dx
        colour = INT(RND * 14) + 1
    END IF
    IF y - r <= 0 OR y + r >= 479 THEN
        dy = -dy
        colour = INT(RND * 14) + 1
    END IF

    CIRCLE (x, y), r, colour
    PAINT (x, y), colour, colour

    ' a short pause keeps the speed sensible on a fast machine
    FOR pause = 1 TO 1200: NEXT pause
LOOP WHILE INKEY$ = ""

SCREEN 0
END
