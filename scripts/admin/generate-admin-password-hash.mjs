#!/usr/bin/env node
import { createHash } from "node:crypto";

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

const hash = createHash("sha256")
  .update(`${salt}:${password}`)
  .digest("hex");

console.log(hash);
