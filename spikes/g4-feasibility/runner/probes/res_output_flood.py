# G4 spike probe — output flood (original synthetic).
# Streams 4 KiB lines forever; the supervisor hard cap (8 MiB) then the wall
# deadline (3 s) must stop capture and kill the job; recorded output is
# truncated to the 1 MiB evidence cap.
while True:
    print("FLOOD" + "x" * 4091, flush=True)
