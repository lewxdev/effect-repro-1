import { NodeRuntime } from "@effect/platform-node";
import { Effect, Function } from "effect";

const program = Effect.log("hello effect");

Function.pipe(
  program,
  NodeRuntime.runMain(),
);
