import { mock } from "node:test";

// Advance broker leases and command deadlines without waiting in real time.
mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
process.on("message", ({ advance, id }) => {
  mock.timers.tick(advance);
  setImmediate(() => process.send({ id }));
});
