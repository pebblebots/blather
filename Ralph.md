Read learnings.md.

You are running a single invocation of a loop. Each trip through the loop, you
will:

 - Take a task from `testing_tasks.json` that has no unsatisfied
   dependencies and is not yet complete;
 - Do not assume the task is unimplemented, since your execution has been
   interrupted several times
 - Implement the task if needed;
 - Verify that all tests pass;
 - Update learnings.md with anything non-trivial you discovered getting
   it working;
 - Update tasks.json
    - complete the target task if complete;
    - create any new subgraph of tasks discovered.

