Create a comprehensive *test plan* for this project. Our goal is for
developers, agentic and human, to be able to move with extremely high
confidence when modifying any part of the project.

1. Both front-end and back-end: cover with unit tests. Make it convenient
and zero-effort to run all relevant unit tests in between changes.

2. End-to-end:  some end-to-end client flows tested via selenium, playwright, or
comparable browser automation tech.

Compose this plan as a sequence of *tasks* in `testing_tasks.json` in the
cwd. A task is a description, an id, a possibly empty vector of IDs it
depends on, and a completion status.
