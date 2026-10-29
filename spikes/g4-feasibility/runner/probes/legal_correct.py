# G4 spike probe — legal job, CORRECT submission (original synthetic).
# Bounded Python pure-function exercise, AD-12's own seed. The approved
# deterministic tests run here against test INPUTS only; the supervisor
# (server analog) compares the printed results against the expected values.
def verdict(score: int) -> str:
    return "pass" if score >= 80 else "recover"

CASES = [(80, "pass"), (79, "recover"), (100, "pass"), (0, "recover")]
print({"results": [{"in": s, "out": verdict(s)} for s, _ in CASES], "shape": "sentinel-1"})
