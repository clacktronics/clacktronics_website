' Clack Synth - play the keyboard like an octave of a synthesiser.
' Keys A to K are the white notes, W E T Y U the black ones.
' Press Esc to stop.

SCREEN 12
COLOR 10
PRINT "  CLACK SYNTH"
PRINT
COLOR 7
PRINT "  White notes:  A S D F G H J K"
PRINT "  Black notes:   W E   T Y U"
PRINT "  Octave:       Z down, X up"
PRINT "  Esc quits."
PRINT

octave = 4

DO
    k$ = UCASE$(INKEY$)
    IF k$ <> "" THEN
        note = 0
        IF k$ = "A" THEN note = 1
        IF k$ = "W" THEN note = 2
        IF k$ = "S" THEN note = 3
        IF k$ = "E" THEN note = 4
        IF k$ = "D" THEN note = 5
        IF k$ = "F" THEN note = 6
        IF k$ = "T" THEN note = 7
        IF k$ = "G" THEN note = 8
        IF k$ = "Y" THEN note = 9
        IF k$ = "H" THEN note = 10
        IF k$ = "U" THEN note = 11
        IF k$ = "J" THEN note = 12
        IF k$ = "K" THEN note = 13

        IF k$ = "Z" AND octave > 1 THEN octave = octave - 1
        IF k$ = "X" AND octave < 7 THEN octave = octave + 1
        IF k$ = CHR$(27) THEN EXIT DO

        IF note > 0 THEN
            ' equal temperament, counted in semitones from A
            freq = 55 * 2 ^ (octave - 1) * 2 ^ ((note - 1) / 12)
            ' a bar per note, rising across the octave
            LINE (40, 140)-(600, 460), 0, BF
            LINE (40 + note * 40, 440 - note * 22)-(70 + note * 40, 460), 9 + (note MOD 6), BF
            SOUND freq, 2
        END IF
    END IF
LOOP

SCREEN 0
END
