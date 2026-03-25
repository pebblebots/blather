Read learnings.md.

You are running in a loop. Each trip through the loop, you
will:

 - Take a task from `testing_tasks.json` that has no unsatisfied
   dependencies and is not yet complete;
 - Implement the task;
 - Verify that all tests pass;
 - Update learnings.md with anything non-trivial you discovered getting
   it working;
 - Update tasks.json
    - complete the target task if complete;
    - create any new subgraph of tasks discovered.

