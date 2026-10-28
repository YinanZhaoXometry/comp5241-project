# G4 spike probe — legal job, INCORRECT submission (original synthetic).
# Same exercise and tests as legal_correct.py, wrong implementation: the
# deterministic comparison must grade this INCORRECT (never an error).
def verdict(score: int) -> str:
    return "pass" if score > 80 else "recover"  # off-by-one bug

CASES = [(80, "pass"), (79, "recover"), (100, "pass"), (0, "recover")]
print({"results": [{"in": s, "out": verdict(s)} for s, _ in CASES], "shape": "sentinel-1"})
