# G4 spike probe — legal job, RUNTIME ERROR submission (original synthetic).
# A crash is an explicit runtime-error outcome with a traceback, never a
# model-awarded score.
def verdict(score: int) -> str:
    if score < 0:
        raise ValueError("negative score is not a valid input")
    return "pass"

verdict(-1)
