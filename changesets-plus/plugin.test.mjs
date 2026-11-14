// Run after `pnpm build`: node --test plugin.test.mjs
// Checks the built single-file plugin, which is what Buzz loads.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import * as plugin from "./plugin.js";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
const source = readFileSync(new URL("./plugin.js", import.meta.url), "utf8");

test("plugin.js has no imports and nothing that needs a bundler", () => {
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\bimport\(/);
  assert.doesNotMatch(source, /\brequire\(/);
  assert.doesNotMatch(source, /react\/jsx-runtime/);
});

test("the manifest is valid for API v1", () => {
  assert.equal(manifest.apiVersion, 1);
  assert.match(manifest.id, /^[a-z][a-z0-9.-]*$/);
  assert.ok(Buffer.byteLength(manifest.description) <= 280);
  assert.deepEqual(Object.keys(manifest).sort(), ["apiVersion", "description", "discovery", "host", "id", "name"]);
  assert.deepEqual(manifest.host.processes, [{ id: "git", program: "git" }]);
});

test("apply registers its card, panel and Settings page", () => {
  assert.deepEqual(plugin.inject, ["react", "panels", "host", "conversation", "relay", "agents", "settingsCards"]);
  const got = {};
  let effects = 0;
  let relayListeners = 0;
  plugin.apply({
    react: React,
    host: { spawn: async () => { throw new Error("no git in this test"); } },
    effect: (fn) => { effects++; fn(); },
    relay: { snapshot: () => ({ status: "connecting" }), subscribe: () => (relayListeners++, () => {}) },
    agents: { snapshot: () => ({ running: [] }), wake: () => {} },
    conversation: { registerAccessory: (a) => (got.accessory = a) },
    panels: { register: (p) => (got.panel = p) },
    settingsCards: { register: (s) => (got.settings = s) },
  });
  assert.equal(effects, 1);
  assert.equal(relayListeners, 1);
  assert.equal(got.accessory.placement, "message");
  assert.equal(got.panel.id, "changes");
  assert.equal(got.settings.title, "Changesets");
  assert.ok(got.panel.matches(plugin.targetFor("abc", 0, "a.txt")));
});

test("without host processes (not the desktop app) it registers nothing", () => {
  let registered = false;
  plugin.apply({
    react: React,
    host: {},
    effect: () => {},
    conversation: { registerAccessory: () => (registered = true) },
    panels: { register: () => (registered = true) },
    settingsCards: { register: () => (registered = true) },
  });
  assert.equal(registered, false);
});
