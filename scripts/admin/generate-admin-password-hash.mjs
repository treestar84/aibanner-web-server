#!/usr/bin/env node
import { pbkdf2Sync } from "node:crypto";

const PBKDF2_ITERATIONS = 310_000;

function usage() {
  console.error(
    "Usage: node scripts/admin/generate-admin-password-hash.mjs <password> <salt>"
  );
  process.exit(1);
}

const password = process.argv[2];
const salt = process.argv[3];

if (!password || !salt) {
  usage();
}

const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256")
  .toString("hex");

console.log(`pbkdf2$${PBKDF2_ITERATIONS}$${hash}`);
