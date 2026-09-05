# Buildathon submission artifacts

TrustGate was submitted to the Razorpay AI Buildathon in September 2026. These four files exist
because of that submission and for no other reason: they are the things you write to *present* a
project rather than to build one.

They are kept rather than deleted because they are an honest record of what was claimed, to whom,
and on what date — and because a claim made in a submission form is exactly the kind of thing worth
being able to check later against what the system actually does.

Nothing here is referenced by the application, the test suite, or the README. Skip this folder if
you are reading the project.

| File | What it is |
|---|---|
| `scope.md` | The positioning statement written for the submission |
| `form-answers.md` | Paste-ready answers for the submission form |
| `voiceover.md` | Narration matched to the recorded demo take |
| `teleprompter.txt` | The same narration as flat text, for reading on camera |

## What is *not* here, deliberately

`demo/script.md` stays where it is. It reads like a recording script and it is also the only
document that explains how to run the whole system end to end — and three tests hang off it,
including the one that keeps the spoken mutation count matching what `make mutation` prints and the
one that refuses claims this project will not make. Those guards have each caught a real mistake.

`demo/unguarded.py` stays too, and is not a demo artifact in any sense that matters: it is the
project's own code paying an attacker on purpose, and it is the strongest thing in the repository.
