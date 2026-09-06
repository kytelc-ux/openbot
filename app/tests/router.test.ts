import { expect, test } from "bun:test";
import { router } from "../src/router";

test("provides the generated index route", () => {
  expect(router.routesByPath["/"]?.fullPath).toBe("/");
});

test("provides the protected credential administration route", () => {
  expect(router.routesByPath["/admin/credentials"]?.fullPath).toBe(
    "/admin/credentials",
  );
});

test("provides Cloud Team inside the authenticated app", () => {
  expect(router.routesByPath["/cloud-team"]?.id).toBe(
    "/_authed/_app/cloud-team",
  );
});
