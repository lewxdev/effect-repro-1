import { HttpClient, HttpClientResponse } from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, Schedule, TestClock } from "effect";

const DURATION = 1000;
const RECUR = 3;

// mock implementation that echoes the requested status
const httpClient = HttpClient.make((request, url) =>
  Effect.sync(() => {
    const status = Number(url.pathname.slice(1));
    const response = new Response(null, { status });
    return HttpClientResponse.fromWeb(request, response);
  })
);

const retryTransient = Layer.succeed(
  HttpClient.HttpClient,
  httpClient.pipe(
    HttpClient.retryTransient({
      schedule: Schedule.spaced(DURATION),
      times: RECUR,
    }),
  ),
);

const retryTransientResponseOnly = Layer.succeed(
  HttpClient.HttpClient,
  httpClient.pipe(
    HttpClient.retryTransient({
      mode: "response-only",
      schedule: Schedule.spaced(DURATION),
      times: RECUR,
      while: (response) => response.status === 408,
    }),
  ),
);

const testResponse = ({ status, isTransient }: { status: number; isTransient: boolean }) =>
  Effect.gen(function*() {
    const attemptsExpected = isTransient ? RECUR + 1 : 1;
    const attemptsRef = yield* Ref.make(0);
    const client = yield* Effect.map(
      HttpClient.HttpClient,
      HttpClient.tapRequest(() => Ref.update(attemptsRef, (n) => n + 1)),
    );

    const fiber = yield* Effect.fork(client.get(`http://_/${status}`));
    yield* TestClock.adjust(DURATION * RECUR);

    const response = yield* Fiber.join(fiber);
    expect(response.status).toBe(status);
    const attempts = yield* Ref.get(attemptsRef);
    expect(attempts).toBe(attemptsExpected);
  });

describe("HttpClient.HttpClient", () => {
  const responses = [
    // HTTP 200 OK
    { status: 200, isTransient: false },

    // HTTP 408 Request Timeout
    // it SHOULD be considered transient, but `retryTransient` doesn't consider it transient
    // even if we explicitly set the `while` Predicate to check for the 408 status in "response-only" mode
    { status: 408, isTransient: true },

    // HTTP 500 Internal Server Error
    // it SHOULD ALWAYS be considered transient, but if `retryTransient` is provided with a `while` Predicate
    // that omits this status, it won't be retried
    { status: 500, isTransient: true },

    // HTTP 501 Not Implemented
    // it SHOULD NEVER be considered transient, but `retryTransient` considers it transient
    { status: 501, isTransient: false },
  ];
  const tests = [
    { name: "retryTransient", layer: retryTransient },
    { name: "retryTransient mode: 'response-only'", layer: retryTransientResponseOnly },
  ];

  for (const test of tests) {
    describe(test.name, () => {
      it.layer(test.layer)(({ effect }) => {
        for (const opts of responses) {
          effect(`GET /${opts.status}`, () => testResponse(opts));
        }
      });
    });
  }
});
