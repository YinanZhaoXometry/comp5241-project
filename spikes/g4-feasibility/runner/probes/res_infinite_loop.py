# G4 spike probe — infinite CPU loop (original synthetic).
# No output; the supervisor wall deadline plus the CPU quota must stop it.
x = 0
while True:
    x = (x + 1) % 1_000_003
