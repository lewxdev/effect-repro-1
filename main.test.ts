import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Ref, Schedule } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

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

const httpClientWithRetryTransient = Layer.succeed(
  HttpClient.HttpClient,
  httpClient.pipe(
    HttpClient.retryTransient({
      schedule: Schedule.spaced(DURATION),
      times: RECUR,
    }),
  ),
);

describe("HttpClient.HttpClient", () => {
  it.layer(httpClientWithRetryTransient)("with retryTransient", ({ effect }) => {
    effect.each([
      { status: 200, isTransient: false },
      { status: 408, isTransient: true },
      { status: 500, isTransient: true },
      { status: 501, isTransient: false },
    ])("HTTP $status isTransient: $isTransient", ({ status, isTransient }) =>
      Effect.gen(function*() {
        const attemptsExpected = isTransient ? RECUR + 1 : 1;
        const attemptsRef = yield* Ref.make(0);
        const client = yield* HttpClient.HttpClient.useSync(
          HttpClient.tapRequest(() => Ref.update(attemptsRef, (n) => n + 1)),
        );

        const fiber = yield* Effect.forkChild(client.get(`http://_/${status}`));
        yield* TestClock.adjust(DURATION * RECUR);

        const response = yield* Fiber.join(fiber);
        expect(response.status).toBe(status);
        const attempts = yield* Ref.get(attemptsRef);
        expect(attempts).toBe(attemptsExpected);
      }));
  });
});
