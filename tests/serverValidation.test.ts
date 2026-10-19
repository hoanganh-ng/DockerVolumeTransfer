import test from "node:test";
import assert from "node:assert/strict";
import {
  validateServerInput,
  formatServerAddress,
} from "../src/components/servers/serverValidation.ts";

test("validateServerInput accepts valid server details", () => {
  const result = validateServerInput({
    name: "Production Server",
    host: "192.168.1.100",
    username: "ubuntu",
    port: 22,
    ssh_key_path: "/home/user/.ssh/id_ed25519",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, {});
});

test("validateServerInput rejects empty name, host, username, ssh_key_path", () => {
  const result = validateServerInput({
    name: "   ",
    host: "",
    username: " ",
    port: 22,
    ssh_key_path: "",
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "Server name is required");
  assert.equal(result.errors.host, "Host/IP is required");
  assert.equal(result.errors.username, "Username is required");
  assert.equal(result.errors.ssh_key_path, "SSH key path is required");
});

test("validateServerInput rejects invalid port numbers", () => {
  const negative = validateServerInput({
    name: "Test",
    host: "localhost",
    username: "root",
    port: 0,
    ssh_key_path: "/key",
  });
  assert.equal(negative.valid, false);
  assert.equal(negative.errors.port, "Port must be between 1 and 65535");

  const tooHigh = validateServerInput({
    name: "Test",
    host: "localhost",
    username: "root",
    port: 70000,
    ssh_key_path: "/key",
  });
  assert.equal(tooHigh.valid, false);
  assert.equal(tooHigh.errors.port, "Port must be between 1 and 65535");

  const notNumber = validateServerInput({
    name: "Test",
    host: "localhost",
    username: "root",
    port: "not-a-port" as any,
    ssh_key_path: "/key",
  });
  assert.equal(notNumber.valid, false);
  assert.equal(notNumber.errors.port, "Port must be a valid number");
});

test("formatServerAddress formats correctly", () => {
  assert.equal(
    formatServerAddress("ubuntu", "192.168.1.50", 22),
    "ubuntu@192.168.1.50:22"
  );
  assert.equal(
    formatServerAddress("root", "example.com", 2222),
    "root@example.com:2222"
  );
});
