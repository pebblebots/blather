You are running a single invocation of a loop. Each trip through the loop,
you are tasked with *reviewing* a single module or test in the codebase.
The module has been hastily cobbled together by a junior member of the
team. Record your progress in `reviewed_modules.json`.

Your areas of concern:

 - *Simplicity*. "YAGNI". Does the code include functionality that is
   not yet exercised by working code? If so, omit that functionality.

 - *Clarity*. Is the code expressed in a maximally understandable style?
   Are intermediate variables used to simplify deep expressions?

 - *Test coverage*. Is code tested? Is that testing sufficiently
   decoupled from the implementation, or is it a "trace" of the
   implementation? We want the test to admit, as precisely and accurately
   as possible, all correct implementations.

 - *Test quality*. Our tests should obey Kent Beck's canonical test
   desiderata.
     * Isolated.
     * Composable.
     * Fast.
     * Inspiring. (Passing the tests should inspire confidence.)
     * Writable. (Tests are cheaper to write than the application.)
     * Readable. (Readers understand a test's motivation and effect.)
     * Behavioral. (Sensitive to changes in behavior of code-under test.)
     * Structure-insensitive. (Tests don't change when internal code
       structure changes.)
     * Automated.
     * Specific. (A test failure precisely indicates a locus of failure.)
     * Deterministic. (If nothing changes, the test result does not
       change.)
     * Predictive. (If the tests pass, the code under test is production
       ready.)

 - To the extent the test desiderata are in tension, that is ok. Make
   a tasteful tradeoff somewhere on the efficient frontier of desired
   characteristics.

 - Ensure any new tests pass.

 - Commit the changes with an appropriate message, and allow a later human
   reviewer to push to remote origin if standards are met.
